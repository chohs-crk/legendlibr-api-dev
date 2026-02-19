import { Redis } from "@upstash/redis";

export const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const PREFIX = "flow:session:";

/* ==================================================
   일반 flow 세션 (다른 기능용)
================================================== */

export async function getSession(uid) {
    if (!uid) return null;
    return await redis.get(PREFIX + uid);
}

export async function setSession(uid, data, ttl = 600) {
    if (!uid) return;
    await redis.set(PREFIX + uid, data, { ex: ttl });
}

export async function patchSession(uid, partial, ttl = 600) {
    const cur = await getSession(uid) || {};
    const next = { ...cur, ...partial };
    await setSession(uid, next, ttl);
}

export async function deleteSession(uid) {
    if (!uid) return;
    await redis.del(PREFIX + uid);
}
