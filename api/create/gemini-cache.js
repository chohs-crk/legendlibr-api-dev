export const GEMINI_FLASH_LITE_MODEL =
    process.env.GEMINI_FLASH_LITE_MODEL || "gemini-2.5-flash-lite-latest";

export const GEMINI_FLASH_LITE_STABLE_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_API_VERSION = "v1beta";
export const GEMINI_THINKING_BUDGET_OFF = 0;
export const STORY_CACHE_TTL = process.env.GEMINI_STORY_CACHE_TTL || "120s";
export const STORY_CACHE_MIN_CHARS = Number(process.env.GEMINI_STORY_CACHE_MIN_CHARS || 1800);

function dedupeModels(list) {
    return [...new Set(list.filter(Boolean))];
}

export function getPreferredModelList(preferredModelId = GEMINI_FLASH_LITE_MODEL) {
    return dedupeModels([preferredModelId, GEMINI_FLASH_LITE_STABLE_MODEL]);
}

export function shouldCreateStoryCache(text) {
    return typeof text === "string" && text.trim().length >= STORY_CACHE_MIN_CHARS;
}

export async function createTextCache({
    modelId = GEMINI_FLASH_LITE_MODEL,
    displayName,
    text,
    ttl = STORY_CACHE_TTL,
    uid,
}) {
    const models = getPreferredModelList(modelId);
    let lastError = null;

    for (const candidateModelId of models) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/cachedContents`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": process.env.GEMINI_API_KEY,
                    },
                    body: JSON.stringify({
                        model: `models/${candidateModelId}`,
                        displayName,
                        ttl,
                        contents: [
                            {
                                role: "user",
                                parts: [{ text }],
                            },
                        ],
                    }),
                }
            );

            const data = await res.json().catch(() => null);

            if (!res.ok) {
                const message = data?.error?.message || "CACHE_CREATE_FAILED";
                const err = new Error(message);
                err.status = res.status;
                err.details = data;
                throw err;
            }

            return {
                name: data?.name,
                modelId: candidateModelId,
                cachedContentTokenCount: data?.usageMetadata?.totalTokenCount ?? null,
                expireTime: data?.expireTime || null,
                raw: data,
            };
        } catch (err) {
            lastError = err;
            console.warn("[AI][CACHE_CREATE_FAIL]", {
                uid,
                modelId: candidateModelId,
                message: err?.message,
                status: err?.status,
            });
        }
    }

    throw lastError || new Error("CACHE_CREATE_FAILED");
}
