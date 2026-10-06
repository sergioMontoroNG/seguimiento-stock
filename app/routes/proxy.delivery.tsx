// App Proxy: GET /apps/delivery?variant=<id numérico de variante>[&qty=<unidades>][&debug=1]
// Consulta el inventario por ubicación y devuelve el origen del stock y la fecha estimada
// de entrega (hoy + días según el origen, días naturales).
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Orden = prioridad. Se usa la primera ubicación de la lista que cubra TODA la cantidad pedida (qty, por
// defecto 1). Los pedidos no se dividen: si la ubicación corta no llega, toda la línea va a la siguiente.
const SOURCES = [
  { name: "Newgarden GOLD 3PL Dallas", days: 4 },
  { name: "NEW GARDEN MEXICO (PIRINEOS)", days: 18 },
];

// "Hoy" se calcula en la zona horaria de Dallas, no en la del servidor.
const TIME_ZONE = "America/Chicago";

const QUERY = `#graphql
  query VariantStock($id: ID!) {
    productVariant(id: $id) {
      inventoryItem {
        inventoryLevels(first: 50) {
          nodes {
            location { name }
            quantities(names: ["available"]) { name quantity }
          }
        }
      }
    }
  }`;

const norm = (s: string) => s.trim().toLowerCase();

function todayPlusDays(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  const d = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + days));
  return d.toISOString().slice(0, 10);
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin) return json({ error: "app not installed" }, 500);

  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") || "";
  if (!/^\d{1,20}$/.test(variant)) {
    return json({ error: "variant must be a numeric id" }, 400);
  }

  const qtyParam = url.searchParams.get("qty") || "1";
  if (!/^\d{1,6}$/.test(qtyParam) || Number(qtyParam) < 1) {
    return json({ error: "qty must be a positive integer" }, 400);
  }
  const qty = Number(qtyParam);

  try {
    const response = await admin.graphql(QUERY, {
      variables: { id: `gid://shopify/ProductVariant/${variant}` },
    });
    const body = await response.json();
    if (!body.data?.productVariant) {
      console.warn(`Variant ${variant} not found`);
      return json({ error: "variant not found" }, 404);
    }
    const nodes: {
      location: { name: string };
      quantities: { name: string; quantity: number }[];
    }[] = body.data?.productVariant?.inventoryItem?.inventoryLevels?.nodes || [];
    const stock: Record<string, number> = {};
    for (const node of nodes) {
      stock[node.location.name] =
        node.quantities.find((q) => q.name === "available")?.quantity ?? 0;
    }

    const stockByNorm = new Map(
      Object.entries(stock).map(([k, v]) => [norm(k), v]),
    );
    const source = SOURCES.find((s) => (stockByNorm.get(norm(s.name)) || 0) >= qty);

    const result: Record<string, unknown> = source
      ? { origin: source.name, days: source.days, date: todayPlusDays(source.days) }
      : { origin: null, days: null, date: null };
    // El proxy es público: las cantidades por ubicación solo se exponen en las tiendas listadas
    // en DELIVERY_DEBUG_SHOPS (dominios myshopify separados por comas, p. ej. la de pruebas)
    const debugShops = (process.env.DELIVERY_DEBUG_SHOPS || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (
      url.searchParams.has("debug") &&
      session?.shop &&
      debugShops.includes(session.shop.toLowerCase())
    ) {
      result.locations = stock;
    }
    return json(result, 200, {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    });
  } catch (err) {
    console.error(err);
    return json({ error: "unexpected error" }, 502);
  }
};
