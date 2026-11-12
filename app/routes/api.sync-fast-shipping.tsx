// Sincronización completa de custom.envio_rapido_uk (carga inicial y repaso periódico).
// GET /api/sync-fast-shipping?shop=<dominio>.myshopify.com[&cursor=<cursor>]   cabecera: x-sync-token: $SYNC_TOKEN
// Procesa 50 variantes por llamada y devuelve { processed, changed, next }: repetir con cursor=next hasta que next sea null.
import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { FAST_KEY, FAST_NAMESPACE, LEVELS_FRAGMENT, ensureDefinition, gql, isFast, setFlags } from "../fast-shipping.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = process.env.SYNC_TOKEN;
  if (!token || request.headers.get("x-sync-token") !== token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) {
    return Response.json({ error: "shop must be a myshopify domain" }, { status: 400 });
  }
  const cursor = url.searchParams.get("cursor") || null;

  try {
    const { admin } = await unauthenticated.admin(shop);
    if (!cursor) await ensureDefinition(admin);
    const data = await gql(
      admin,
      `#graphql
      query ($after: String) {
        productVariants(first: 50, after: $after) {
          nodes {
            id
            metafield(namespace: "${FAST_NAMESPACE}", key: "${FAST_KEY}") { value }
            inventoryItem { ${LEVELS_FRAGMENT} }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after: cursor },
    );
    const page = data.productVariants;
    const changes: { variantId: string; fast: boolean }[] = [];
    for (const v of page.nodes) {
      const fast = isFast(v.inventoryItem?.inventoryLevels?.nodes || []);
      if (v.metafield?.value !== (fast ? "true" : "false")) changes.push({ variantId: v.id, fast });
    }
    await setFlags(admin, changes);
    return Response.json({
      processed: page.nodes.length,
      changed: changes.length,
      next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "unexpected error" }, { status: 502 });
  }
};
