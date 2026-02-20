import { db } from "../../../firebaseAdmin.js";

export const CHAR_LIMIT = 10;

function makeError(code, status = 500, meta) {
    const e = new Error(code);
    e.code = code;
    e.status = status;
    e.meta = meta;
    return e;
}

export async function getUserCharCount(uid) {
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    return snap.exists ? snap.data().charCount || 0 : 0;
}

export async function saveFinalCharacterTx({
    uid,
    input,
    output,
    formattedStory,
    features,
    storyScore,
    stats,
    metaSafety
}) {
    const ref = db.collection("characters").doc();
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async tx => {
        // 1) USER READ (동시성 방어)
        const userSnap = await tx.get(userRef);
        const currentCount = userSnap.exists ? userSnap.data().charCount || 0 : 0;

        if (currentCount >= CHAR_LIMIT) {
            throw makeError("CHARACTER_LIMIT_REACHED", 403);
        }

        // 2) REGION READ (선택)
        const regionId = input.region?.id;
        let regionRef = null;
        let regionData = null;

        if (regionId && !regionId.endsWith("_DEFAULT")) {
            regionRef = db.collection("regionsUsers").doc(regionId);

            const regionSnap = await tx.get(regionRef);
            if (!regionSnap.exists) {
                throw makeError("NO_REGION", 400);
            }
            regionData = regionSnap.data() || {};

            // 권한 검증
            const myRegionRef = db.collection("users").doc(uid).collection("myregion").doc(regionId);
            const myRegionSnap = await tx.get(myRegionRef);

            if (!myRegionSnap.exists) {
                throw makeError("REGION_NOT_REGISTERED", 403);
            }
        }

        // 3) CHARACTER WRITE
        tx.set(ref, {
            uid,
            displayRawName: input.name,
            name: output.name,
            needKorean: !!output.needKorean,

            safety: {
                nameSafetyScore: metaSafety?.nameSafetyScore ?? output.nameSafetyScore ?? 0,
                promptSafetyScore: metaSafety?.promptSafetyScore ?? output.promptSafetyScore ?? 0
            },

            promptRaw: input.prompt || "",
            promptRefined: output.intro || "",

            existence: output.existence || "",
            canSpeak: !!output.canSpeak,
            narrationStyle: output.narrationStyle || "",
            speechStyle: output.speechStyle || "",
            profile: output.profile || "",

            originId: input.origin?.id,
            origin: input.origin?.name,
            originDesc: input.origin?.desc,

            regionId: input.region?.id,
            region: input.region?.name,
            regionDetail: input.region?.detail,

            fullStory: formattedStory,
            features,
            storyTheme: output.theme || "",
            storyScore,

            traits: stats?.traits || {},
            scores: stats?.scores || {},
            skills: stats?.skills || [],

            rankScore: 1000,
            battleCount: 0,
            createdAt: new Date()
        });

        // 4) USER UPDATE
        tx.set(
            userRef,
            {
                charCount: currentCount + 1
            },
            { merge: true }
        );

        // 5) REGION UPDATE
        if (regionRef) {
            const currentNum = regionData?.charnum || 0;
            const updateData = { charnum: currentNum + 1 };

            if (currentNum === 0) {
                updateData.ownerchar = {
                    id: ref.id,
                    name: output.name
                };
            }

            tx.update(regionRef, updateData);
        }
    });

    return ref.id;
}
