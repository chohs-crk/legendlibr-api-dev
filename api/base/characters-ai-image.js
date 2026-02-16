import { withApi } from "../_utils/withApi.js";
import admin from "firebase-admin";
import { db } from "../../firebaseAdmin.js";
import { applyUserMetaDelta } from "./_internal/user-meta-update.js";
import { SAFETY_RULES } from "../base/safetyrules.js";
import { ORIGINS } from "../base/data/origins.js";
import { randomUUID } from "crypto";
/* =========================
   스타일 매핑 (Gemini 전용)
========================= */
const STYLE_PROMPTS = {
    anime2d: "2D 애니메이션 스타일, 셀 셰이딩",
    real3d: "사실적인 3D 렌더링, 물리 기반 질감",
    watercolor: "수채화 일러스트, 부드러운 번짐",
    darkfantasy: "다크 판타지, 어두운 색조와 대비",
    pixel: "픽셀 아트, 레트로 게임 스타일"
};

const CHARACTER_FOCUS_PROMPT = `
단독 인물 초상
상반신 또는 흉상 중심 구도
얼굴과 표정이 화면의 중심
카메라는 가슴 위 또는 어깨 위 클로즈업
눈과 얼굴 디테일에 조명 집중
배경은 흐릿하고 단순하게 처리
주인공 강조 구도
`;


/* =========================
   GPT: 프롬프트 + 점수
========================= */
async function buildImagePromptAndScore(input) {
    const systemPrompt = `
너는 RPG 게임용 캐릭터 일러스트를 설계하는 이미지 프롬프트 전문가다.
너의 목적은 "캐릭터가 화면의 주인공으로 강하게 인식되는 이미지"를 만들기 위한
프롬프트를 생성하는 것이다.

${SAFETY_RULES}

[역할]
- 캐릭터는 항상 장면의 중심이며, 배경보다 시각적으로 우선되어야 한다.
- 배경은 캐릭터의 정체성을 보조하는 장치일 뿐, 주제가 아니다.

[해야 할 일]
1. 캐릭터 이미지 프롬프트 생성
   - 외형(체형, 복장, 장비, 자세, 표정)을 명확히 묘사
   - "단독 인물", "주인공", "영웅적 구도"를 기본 전제로 한다
   - 전신 또는 반신 기준, 카메라는 정면 또는 약간 아래에서 바라본 시점

2. 배경 이미지 프롬프트 생성
   - 장소의 분위기와 상징만 전달
   - 배경은 흐릿하거나 간결해야 하며, 캐릭터보다 눈에 띄면 안 된다
   - 복잡한 군중, 다수 인물, 과도한 오브젝트는 피한다

3. 점수 평가
   - fitScore: 유저 입력이 캐릭터 설정과 얼마나 잘 어울리는지 (1~100)
   - safetyScore: 안전 규칙 위반 가능성 (0~100)

[강제 규칙]
- 캐릭터 프롬프트와 배경 프롬프트는 반드시 분리
- 캐릭터 > 배경 순서의 시각적 우선순위를 항상 유지
- 선정성, 잔혹성, 현실 정치·종교는 제거하거나 상징화

[출력 형식]
JSON만 출력한다.
{
  "characterPrompt": "...",
  "backgroundPrompt": "...",
  "fitScore": 1~100,
  "safetyScore": 0~100
}
`;


    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            temperature: 0.25,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(input) }
            ]
        })
    });

    const json = await res.json();
    const text = json.choices[0].message.content
        .replace(/```json|```/g, "").trim();
    return JSON.parse(text);
}

/* =========================
   Gemini
========================= */
/* =========================
   Gemini (2026.01.19 수정됨)
========================= */
async function generateImageWithGemini(prompt) {
    // 1. 모델명: 1월 15일 셧다운된 preview 대신 '정식 버전' 사용
    // 2. API 버전: 이미지 생성 기능이 포함된 'v1beta' 사용 필수
    const MODEL_ID = "gemini-2.5-flash-image";
    const API_VERSION = "v1beta";

    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                // 중요: 이미지 출력을 명시적으로 요청 (v1beta 기능)
                generationConfig: {
                    responseModalities: ["IMAGE"]
                }
            })
        }
    );

    const json = await res.json();

    if (json.error) {
        console.error("Gemini API Error Detail:", JSON.stringify(json.error, null, 2));
        throw new Error(`GEMINI_API_ERROR: ${json.error.message}`);
    }

    // 응답 구조 확인 (이미지는 inlineData 형태로 반환됨)
    const part = json.candidates?.[0]?.content?.parts
        ?.find(p => p.inlineData?.data);

    if (!part) {
        throw new Error("GEMINI_IMAGE_FAILED: No image data returned. Check prompt safety or model availability.");
    }

    return Buffer.from(part.inlineData.data, "base64");
}

/* =========================
   handler
========================= */
export default withApi("expensive", async (req, res, { uid }) => {
   
    const { id, prompt, style } = req.body;

    const ref = db.collection("characters").doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
        return res.status(404).json({
            ok: false,
            error: "CHAR_NOT_FOUND"
        });
    }

    const data = snap.data();


    const result = await buildImagePromptAndScore({
        promptRefined: data.promptRefined,
        fullStory: data.fullStory ?? data.finalStory,
        userPrompt: prompt
    });

    if (result.safetyScore > 75) {
        return res.status(403).json({
            ok: false,
            error: "SAFETY_BLOCKED",
            safetyScore: result.safetyScore
        });
    }

    const userMeta = await applyUserMetaDelta(uid, { frameDelta: -10 });


    let background = result.backgroundPrompt;
    if (data.regionId?.endsWith("_DEFAULT")) {
        background = ORIGINS[data.originId]?.background || background;
    }

    const finalPrompt = `
[캐릭터]
${result.characterPrompt}

[배경]
${background}

[구도]
${CHARACTER_FOCUS_PROMPT}

[스타일]
${STYLE_PROMPTS[style] || ""}
`;

    

    const buffer = await generateImageWithGemini(finalPrompt);

    const bucket = admin.storage().bucket();
    const path = `characters/${id}/ai/${Date.now()}.png`;

    // ✅ download token 생성
    const token = randomUUID();

    // ✅ Firebase Storage에서 브라우저가 바로 열 수 있게 토큰 메타데이터 부여
    await bucket.file(path).save(buffer, {
        metadata: {
            contentType: "image/png",
            metadata: {
                firebaseStorageDownloadTokens: token
            }
        }
    });

    // ✅ 토큰 포함 URL (브라우저 <img>에서 즉시 로딩됨)
    const url =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;


    await ref.update({
        image: { type: "ai", key: "ai", url },
        aiImages: admin.firestore.FieldValue.arrayUnion({
            url,
            fitScore: result.fitScore,
            safetyScore: result.safetyScore,
            createdAt: Date.now()
        })
    });

    res.json({
        ok: true,
        imageUrl: url,
        userMeta   // 🔥 추가
    });

});