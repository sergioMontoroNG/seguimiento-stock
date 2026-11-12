// Metacampo de variante custom.envio_rapido_uk (booleano): true si el almacén local (FAST_SHIPPING_LOCATION) tiene
// al menos 1 unidad disponible. Lo lee el tema en Liquid (filtro «Solo envío rápido» de colecciones) sin llamar a la app.
// Lo mantienen: el webhook inventory_levels/update (webhooks.inventory.tsx) y la sincronización completa (api.sync-fast-shipping.tsx).
export const FAST_NAMESPACE = "custom";
export const FAST_KEY = "envio_rapido_uk";

const FAST_LOCATION = (process.env.FAST_SHIPPING_LOCATION || "NEWGARDEN SPAIN UK LIMITED")
  .trim()
  .toLowerCase();

export type Level = {
  location: { name: string };
  quantities: { name: string; quantity: number }[];
};

export const LEVELS_FRAGMENT = `inventoryLevels(first: 10) {
  nodes { location { name } quantities(names: ["available"]) { name quantity } }
}`;

export function isFast(levels: Level[]): boolean {
  return levels.some(
    (l) =>
      l.location.name.trim().toLowerCase() === FAST_LOCATION &&
      (l.quantities.find((q) => q.name === "available")?.quantity ?? 0) >= 1,
  );
}

type Admin = { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> };

async function run(admin: Admin, query: string, variables: Record<string, unknown>) {
  const body = await (await admin.graphql(query, { variables })).json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

export async function ensureDefinition(admin: Admin) {
  const data = await run(
    admin,
    `#graphql
    mutation ($def: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $def) {
        userErrors { code message }
      }
    }`,
    {
      def: {
        name: "Envío rápido UK",
        namespace: FAST_NAMESPACE,
        key: FAST_KEY,
        type: "boolean",
        ownerType: "PRODUCTVARIANT",
        description: "Lo mantiene la app seguimiento-stock: stock disponible en el almacén local.",
        access: { storefront: "PUBLIC_READ" },
      },
    },
  );
  const errs = (data.metafieldDefinitionCreate?.userErrors || []).filter(
    (e: { code: string }) => e.code !== "TAKEN",
  );
  if (errs.length) throw new Error(JSON.stringify(errs));
}

// Escribe los valores en bloques de 25 (límite de metafieldsSet)
export async function setFlags(admin: Admin, flags: { variantId: string; fast: boolean }[]) {
  for (let i = 0; i < flags.length; i += 25) {
    const data = await run(
      admin,
      `#graphql
      mutation ($m: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $m) { userErrors { field message } }
      }`,
      {
        m: flags.slice(i, i + 25).map((f) => ({
          ownerId: f.variantId,
          namespace: FAST_NAMESPACE,
          key: FAST_KEY,
          type: "boolean",
          value: f.fast ? "true" : "false",
        })),
      },
    );
    const errs = data.metafieldsSet?.userErrors || [];
    if (errs.length) throw new Error(JSON.stringify(errs));
  }
}

export { run as gql };
