import { db } from "../../../firebaseAdmin.js";
import admin from "firebase-admin";

function clamp(v, min = 0, max = 100000) {
    return Math.max(min, Math.min(max, v));
}

function calcLevel(exp) {
    return Math.floor(exp / 500) + 1;
}

/**
 * 서버 내부 전용: 재화/경험치 변경 (트랜잭션)
 * - scroll: 두루마리
 * - frame: 액자
 * - 부족하면 에러 throw (INSUFFICIENT_SCROLL / INSUFFICIENT_FRAME)
 */
export async function applyUserMetaDelta(uid, {
    expDelta = 0,
    scrollDelta = 0,
    frameDelta = 0,
} = {}) {
    const ref = db.collection("users").doc(uid);

    return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);

        // 없으면 생성(0,0,0) 후 계속 진행 (너의 정책 반영)
        if (!snap.exists) {
            tx.set(ref, {
                level: 1,
                exp: 0,
                currency: { scroll: 0, frame: 0 },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        const d = snap.exists ? snap.data() : { exp: 0, currency: { scroll: 0, frame: 0 } };

        const curScroll = d.currency?.scroll ?? 0;
        const curFrame = d.currency?.frame ?? 0;

        // ✅ 부족 체크(차감이 음수일 때만)
        if (scrollDelta < 0 && curScroll + scrollDelta < 0) {
            const err = new Error("INSUFFICIENT_SCROLL");
            err.code = "INSUFFICIENT_SCROLL";
            throw err;
        }
        if (frameDelta < 0 && curFrame + frameDelta < 0) {
            const err = new Error("INSUFFICIENT_FRAME");
            err.code = "INSUFFICIENT_FRAME";
            throw err;
        }

        const nextExp = Math.max(0, (d.exp ?? 0) + expDelta);
        const nextLevel = calcLevel(nextExp);

        const nextScroll = clamp(curScroll + scrollDelta);
        const nextFrame = clamp(curFrame + frameDelta);

        tx.set(ref, {
            exp: nextExp,
            level: nextLevel,
            currency: { scroll: nextScroll, frame: nextFrame },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { level: nextLevel, exp: nextExp, scroll: nextScroll, frame: nextFrame };
    });
}
