import { Redis } from "@upstash/redis";

export const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const PREFIX = "flow:session:";

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
const BATTLE_PREFIX = "battle:session:";

export async function getBattleSession(uid) {
    if (!uid) return null;
    return await redis.get(BATTLE_PREFIX + uid);
}

export async function setBattleSession(uid, data, ttl = 600) {
    if (!uid) return;
    await redis.set(BATTLE_PREFIX + uid, data, { ex: ttl });
}

export async function deleteBattleSession(uid) {
    if (!uid) return;
    await redis.del(BATTLE_PREFIX + uid);
}
