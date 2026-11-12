import { Redis } from "@upstash/redis";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

type Entry = { session: Session | undefined; at: number };

// Fresh window: no Redis read at all. Stale window: used only if Redis fails.
const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const sessionKey = (id: string) => `session:${id}`;
const shopKey = (shop: string) => `shop:${shop}`;

export class RedisSessionStorage implements SessionStorage {
  private cache = new Map<string, Entry>();

  constructor(private redis: Redis) {}

  private remember(id: string, session: Session | undefined) {
    if (this.cache.size >= MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(id, { session, at: Date.now() });
  }

  async storeSession(session: Session): Promise<boolean> {
    const data = JSON.stringify(session.toPropertyArray(true));
    await Promise.all([
      this.redis.set(sessionKey(session.id), data),
      this.redis.sadd(shopKey(session.shop), session.id),
    ]);
    this.remember(session.id, session);
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.session;

    try {
      const raw = await this.redis.get<string | [string, string | number | boolean][]>(
        sessionKey(id),
      );
      const session = raw
        ? Session.fromPropertyArray(
            typeof raw === "string" ? JSON.parse(raw) : raw,
            true,
          )
        : undefined;
      this.remember(id, session);
      return session;
    } catch (error) {
      if (hit && Date.now() - hit.at < STALE_MS) return hit.session;
      throw error;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.deleteSessions([id]);
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    await this.redis.del(...ids.map(sessionKey));
    ids.forEach((id) => this.cache.delete(id));
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const ids = await this.redis.smembers(shopKey(shop));
    const sessions = await Promise.all(ids.map((id) => this.loadSession(id)));
    return sessions.filter((s): s is Session => !!s);
  }
}

export function createSessionStorage() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Faltan KV_REST_API_URL / KV_REST_API_TOKEN (Upstash Redis)");
  }
  return new RedisSessionStorage(new Redis({ url, token }));
}
