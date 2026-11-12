// Webhook inventory_levels/update: recalcula custom.envio_rapido_uk de la variante cuyo inventario ha cambiado.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { FAST_KEY, FAST_NAMESPACE, LEVELS_FRAGMENT, gql, isFast, setFlags } from "../fast-shipping.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, admin, topic, shop } = await authenticate.webhook(request);
  const itemId = payload?.inventory_item_id;
  if (!admin || !itemId) return new Response();

  try {
    const data = await gql(
      admin,
      `#graphql
      query ($id: ID!) {
        inventoryItem(id: $id) {
          variant { id metafield(namespace: "${FAST_NAMESPACE}", key: "${FAST_KEY}") { value } }
          ${LEVELS_FRAGMENT}
        }
      }`,
      { id: `gid://shopify/InventoryItem/${itemId}` },
    );
    const item = data.inventoryItem;
    if (!item?.variant) return new Response();
    const fast = isFast(item.inventoryLevels.nodes);
    const current = item.variant.metafield?.value;
    if (current !== (fast ? "true" : "false")) {
      await setFlags(admin, [{ variantId: item.variant.id, fast }]);
    }
  } catch (err) {
    // 500 para que Shopify reintente el webhook
    console.error(`Webhook ${topic} (${shop}) falló`, err);
    return new Response("error", { status: 500 });
  }
  return new Response();
};
