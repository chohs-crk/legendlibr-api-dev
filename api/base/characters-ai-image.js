import { withApi } from "../_utils/withApi.js";
import admin from "firebase-admin";
import { db } from "../../firebaseAdmin.js";
import { applyUserMetaDelta } from "./_internal/user-meta-update.js";
import { SAFETY_RULES } from "../base/safetyrules.js";
import { ORIGINS } from "../base/data/origins.js";
import { randomUUID } from "crypto";

/* =========================
   스타일 매핑 (모델 공통)
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
   Together 모델 매핑
   - 프론트에서 넘어오는 model 값을 여기서 Together 실제 model string으로 변환
========================= */
const IMAGE_MODEL_MAP = {

    gemini: {
        provider: "gemini",
        costFrames: 40   // 🔥 40원
    },

    together_qwen: {
        provider: "together",
        model: "Qwen/Qwen-Image",
        costFrames: 5,   // 🔥 5원
        supportsNegativePrompt: false
    },

    together_flux2: {
        provider: "together",
        model: "black-forest-labs/FLUX.2-dev",
        costFrames: 20,  // 🔥 20원
        supportsNegativePrompt: false,
        steps: 20
    }
};

// 캐릭터 이미지 생성 기본 사이즈(세로 인물에 유리)
const DEFAULT_WIDTH = 768;
const DEFAULT_HEIGHT = 1024;

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
   - 기존 로직 유지
========================= */
async function generateImageWithGemini(prompt) {
    // 1. 모델명: preview 대신 정식 버전 사용
    // 2. API 버전: 이미지 생성 기능이 포함된 'v1beta' 사용
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

    const part = json.candidates?.[0]?.content?.parts
        ?.find(p => p.inlineData?.data);

    if (!part) {
        throw new Error("GEMINI_IMAGE_FAILED: No image data returned. Check prompt safety or model availability.");
    }

    return Buffer.from(part.inlineData.data, "base64");
}

/* =========================
   Together Images API (Serverless)
   - POST https://api.together.xyz/v1/images/generations
   - response_format="base64" 로 b64_json 받아서 Buffer 변환
========================= */
async function generateImageWithTogether({
    model,
    prompt,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    steps,
    guidance,
    negativePrompt,
    seed
}) {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) {
        throw new Error("TOGETHER_API_KEY_MISSING");
    }

    const body = {
        model,
        prompt,
        width,
        height,
        response_format: "base64",
        output_format: "png",
        n: 1
    };

    // steps / guidance는 모델에 따라 허용이 다를 수 있음
    if (typeof steps === "number") body.steps = steps;
    if (typeof guidance === "number") body.guidance = guidance;

    // FLUX.2는 공식 문서에서 negative prompt를 지원하지 않는다고 안내됨 → 모델별로만 사용
    if (negativePrompt && typeof negativePrompt === "string") {
        body.negative_prompt = negativePrompt;
    }

    if (typeof seed === "number") body.seed = seed;

    const res = await fetch("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
        console.error("Together API Error:", json);
        const msg = json?.error?.message || json?.message || "TOGETHER_IMAGE_FAILED";
        throw new Error(msg);
    }

    // 1) base64 응답
    const b64 = json?.data?.[0]?.b64_json;
    if (b64) {
        return Buffer.from(b64, "base64");
    }

    // 2) 혹시 url로 오는 경우(모델/설정에 따라) fallback
    const url = json?.data?.[0]?.url;
    if (url) {
        const imgRes = await fetch(url);
        if (!imgRes.ok) throw new Error("TOGETHER_IMAGE_URL_FETCH_FAILED");
        const arr = await imgRes.arrayBuffer();
        return Buffer.from(arr);
    }

    throw new Error("TOGETHER_IMAGE_FAILED: No image data returned.");
}

/* =========================
   handler
========================= */
export default withApi("expensive", async (req, res, { uid }) => {

    const { id, prompt, style, model: modelKey } = req.body;

    const ref = db.collection("characters").doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
        return res.status(404).json({
            ok: false,
            error: "CHAR_NOT_FOUND"
        });
    }

    const data = snap.data();
    if (data.uid !== uid) {
        return res.status(403).json({
            ok: false,
            error: "NOT_OWNER"
        });
    }

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

    // ✅ 모델 선택: 프론트에서 넘어온 modelKey를 기준으로 실행
    const normalizedKey = (modelKey || "gemini").toString();
    const modelInfo = IMAGE_MODEL_MAP[normalizedKey];

    if (!modelInfo) {
        return res.status(400).json({
            ok: false,
            error: "INVALID_MODEL"
        });
    }

    // 1) 이미지 생성 (성공해야만 비용 차감하도록 순서 변경)
    let buffer;
    try {
        if (modelInfo.provider === "gemini") {
            buffer = await generateImageWithGemini(finalPrompt);
        } else {
            buffer = await generateImageWithTogether({
                model: modelInfo.model,
                prompt: finalPrompt,
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
                steps: modelInfo.steps,
                // flux2 flex 같은 경우 필요하면 guidance 추가 (현재 기본은 미사용)
                guidance: modelInfo.guidance,
                // 모델이 negative prompt 지원할 때만 전송
                negativePrompt: modelInfo.supportsNegativePrompt
                    ? "blurry, low quality, distorted, extra fingers, extra limbs, text, watermark"
                    : undefined
            });
        }
    } catch (e) {
        console.error("IMAGE_GENERATION_ERROR:", e);
        return res.status(500).json({
            ok: false,
            error: "IMAGE_GENERATION_FAILED",
            message: String(e?.message || e)
        });
    }

    // 2) 비용(프레임) 차감 (모델별 차등)
    const userMeta = await applyUserMetaDelta(uid, {
        frameDelta: -Math.abs(modelInfo.costFrames || 10)
    });

    // 3) Storage 업로드
    const bucket = admin.storage().bucket();
    const path = `characters/${id}/ai/${Date.now()}.png`;

    const token = randomUUID();

    await bucket.file(path).save(buffer, {
        metadata: {
            contentType: "image/png",
            metadata: {
                firebaseStorageDownloadTokens: token
            }
        }
    });

    const url =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

    // 4) Firestore 반영
    await ref.update({
        image: { type: "ai", key: "ai", url },
        aiImages: admin.firestore.FieldValue.arrayUnion({
            url,
            fitScore: result.fitScore,
            safetyScore: result.safetyScore,
            style: style || null,
            modelKey: normalizedKey,
            model: modelInfo.model || "gemini-2.5-flash-image",
            provider: modelInfo.provider,
            createdAt: Date.now()
        })
    });

    res.json({
        ok: true,
        imageUrl: url,
        userMeta
    });

});