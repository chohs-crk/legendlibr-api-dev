export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { ORIGINS } from "../base/data/origins.js";
import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { callAI } from "./ai.js";




export default withApi("expensive", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }




    // === 1. 입력값 파싱 ===
    const { originId, regionId, displayNameRaw: name, prompt } = req.body;
    console.log("[prompt-init] parsed:", { originId, regionId, name, prompt });



    // === 2. origin 검증 ===
    const originData = ORIGINS[originId];  // <-- 수정: originData 정의
    if (!originData) {
        return res.status(400).json({ ok: false, error: "INVALID_ORIGIN" });
    }

    // === 3. region 처리 ===

    // 🔥 default region 판별 기준 (_DEFAULT 접미사)
    const isDefaultRegion = regionId.endsWith("_DEFAULT");

    let regionData;

    if (isDefaultRegion) {
        // --- default region ---
        const defaultSnap = await db
            .collection("regionsDefault")
            .doc(regionId)
            .get();

        if (!defaultSnap.exists) {
            return res.status(400).json({
                ok: false,
                error: "INVALID_DEFAULT_REGION"
            });
        }

        regionData = defaultSnap.data();
    } else {
        // --- user region ---
        const regionSnap = await db
            .collection("regionsUsers")
            .doc(regionId)
            .get();

        if (!regionSnap.exists) {
            return res.status(400).json({
                ok: false,
                error: "INVALID_REGION"
            });
        }

        regionData = regionSnap.data();

        // === 유저 보유 검증 (user region만) ===
        const myRegionSnap = await db
            .collection("users")
            .doc(uid)
            .collection("myregion")
            .doc(regionId)
            .get();

        if (!myRegionSnap.exists) {
            return res.status(403).json({
                ok: false,
                error: "REGION_NOT_OWNED"
            });
        }
    }




    // === 4. region과 origin 일관성 검증 ===
    if (regionData.originId !== originId) {
        return res.status(400).json({ ok: false, error: "MISMATCH_REGION" });
    }

    // === 5. 기존 세션 존재 여부 ===
    const existing = await getSession(uid);
    if (existing) {
        return res.status(409).json({ ok: false, error: "FLOW_ALREADY_EXISTS" });
    }


    // === 6. 세션 생성 === (구조 동일)
    await deleteSession(uid);
    await setSession(uid, {
        nowFlow: { refine: true, story1: false, story2: false, story3: false, final: false },
        called: false,
        resed: false,
        input: {
            origin: originData,
            region: { ...regionData, id: regionId },
            name,
            prompt
        },
        output: {}
    });

    console.log("[prompt-init] session created:", uid);

    // === 7. AI 호출을 이 요청 안에서 직접 수행 ===
    try {
        console.log("[prompt-init] calling callAI(uid):", uid);
        await callAI(uid);  // <-- 여기서 OpenAI 호출 완료까지 기다림

        // callAI 안에서 세션 상태가 refine -> story1 로 바뀜
        // s.output 도 채워진 상태
        return res.status(200).json({
            ok: true,
            flow: "refine",
            // 필요하면 여기서 세션 결과 일부도 같이 내려줄 수 있음
        });
    } catch (err) {
        console.error("[prompt-init] callAI ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "AI_CALL_FAILED"
        });
    }

    // ⬆ 이제 setImmediate(...) 쪽은 완전히 삭제



});
