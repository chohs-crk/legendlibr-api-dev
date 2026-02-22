// base/data/origins.js
// ⚠️ 서버 전용 — 클라이언트 절대 노출 금지

export const ORIGINS = {
    IRON_CROWN: {
        id: "IRON_CROWN",
        name: "꺼지지 않는 무쇠",
        desc: "끝없는 전쟁과 제련의 불길 속에서 살아남은 중세 도시 연합.",

        longDesc: `
수 세대에 걸친 전쟁으로 단련된 중세 도시들의 연합체.
도시는 항상 연기에 잠겨 있고, 대장간의 망치 소리는 멈추지 않는다.
기사단과 용병단, 귀족 가문들이 권력을 다투며
법보다 무력이, 신념보다 실리가 우선하는 냉혹한 질서가 지배한다.
강철은 생존의 상징이며, 약자는 도시의 그림자 속으로 사라진다.
    `.trim(),

        background:
            "A medieval walled city under a red sunset, distant blacksmith sparks glowing in the air, narrow stone streets, faint smoke drifting upward, slightly blurred background, cinematic lighting, no crowd",

        narrationGuide: {
            tone: "차갑고 무거우며 현실적인 중세 서사",
            vocabulary: "강철, 성벽, 망치, 계약, 명예, 생존, 용병, 기사, 연기 같은 어휘를 선호",
            sentenceStyle: "짧고 단단한 문장을 기본으로 하되, 핵심 장면에서는 감각 묘사를 한 번 더 덧댄다",
            imagery: "연기와 불꽃, 쇠 냄새, 마모된 돌길, 무딘 빛 같은 촉감 중심의 이미지",
            forbidden: "현대적 유행어, 가벼운 농담, 과장된 미사여구, 지나친 감정 설교"
        }
    },

    CHAOS_MIDLANDS: {
        id: "CHAOS_MIDLANDS",
        name: "난세중원",
        desc: "문파와 가문이 얽혀 다투는 혼란의 강호.",

        longDesc: `
수많은 문파와 세력이 흩어져 패권을 다투는 혼란의 중원.
의리는 명분이 되고, 원한은 대를 이어 계승된다.
비급과 내공은 피로 증명되며,
강호의 질서는 검과 주먹, 그리고 소문으로 유지된다.
강자는 이름을 남기고, 약자는 기록조차 남기지 못한다.
    `.trim(),

        background:
            "Misty mountain ranges and rivers stretching across ancient martial lands, bamboo forests surrounding hidden temples, distant inns along mountain paths, soft fog atmosphere, minimal background detail, slightly blurred",

        narrationGuide: {
            tone: "건조한 긴장과 여운이 남는 무림 서사",
            vocabulary: "강호, 문파, 비급, 내공, 원한, 의리, 살기, 객잔, 기연 같은 어휘를 선호",
            sentenceStyle: "단정한 문장으로 흐름을 잡고, 중요한 순간에는 고전적인 호흡으로 문장을 한 박자 늘린다",
            imagery: "안개, 대숲, 낡은 목재, 칼끝의 떨림, 숨의 뜨거움 같은 감각 중심",
            forbidden: "현대적 표현, 지나친 과학 용어, 과장된 영웅 찬가, 노골적 설명"
        }
    },

    AURELION: {
        id: "AURELION",
        name: "아우렐리온",
        desc: "빛과 질서가 지배하는 찬란한 성역.",

        longDesc: `
천상의 질서와 신성한 규율이 유지되는 빛의 영역.
모든 존재는 자신의 역할과 위치를 부여받으며,
혼돈과 타락은 철저히 배제된다.
자비와 정의가 공존하지만,
그 이면에는 완벽함을 강요하는 냉혹한 선택이 존재한다.
    `.trim(),

        background:
            "Floating white celestial city above the clouds, golden pillars and crystal architecture glowing softly, radiant divine light, serene and clean atmosphere, background slightly diffused, no figures",

        narrationGuide: {
            tone: "정제되고 장엄하며 엄숙한 성역 서사",
            vocabulary: "규율, 심판, 서약, 성역, 질서, 정결, 빛, 침묵 같은 어휘를 선호",
            sentenceStyle: "문장을 지나치게 흥분시키지 않고 균형 있게 유지하며, 의미는 마지막 문장에 정리해 준다",
            imagery: "유백색 빛, 고요한 울림, 차가운 공기, 수정의 반사 같은 밝고 차분한 이미지",
            forbidden: "속된 농담, 과도한 폭력성, 지나친 감정 폭발, 난잡한 표현"
        }
    },

    NELGARD: {
        id: "NELGARD",
        name: "넬가드",
        desc: "계약과 배신이 지배하는 지옥의 도시.",

        longDesc: `
끝없는 심연과 불길 위에 세워진 악마들의 도시.
모든 관계는 계약으로 묶이며,
힘은 지위로, 지위는 공포로 증명된다.
배신은 일상이고, 약속은 언제든 뒤집힌다.
구원은 신화에 불과하며, 살아남는 것만이 유일한 규칙이다.
    `.trim(),

        background:
            "A dark obsidian city built over molten lava rivers, towering spires under a crimson sky, faint sulfur mist in the air, ominous glow reflecting from the ground, atmospheric depth, blurred distant structures",

        narrationGuide: {
            tone: "음울하고 냉소적이며 거래의 냄새가 짙은 서사",
            vocabulary: "계약, 대가, 심연, 첨탑, 흑요석, 배신, 속삭임, 공포 같은 어휘를 선호",
            sentenceStyle: "짧은 문장으로 불길함을 쌓고, 핵심 문장에서 냉정한 단정으로 찍어 누른다",
            imagery: "유황 냄새, 붉은 하늘, 검은 광택, 뜨거운 바닥 같은 불쾌한 촉감 중심",
            forbidden: "명랑한 톤, 희극적 과장, 현대적 슬랭, 지나친 장식"
        }
    },

    NEO_ARCADIA: {
        id: "NEO_ARCADIA",
        name: "네오 아르카디아",
        desc: "기술과 욕망이 교차하는 미래의 거대 도시.",

        longDesc: `
초고층 빌딩과 네온이 뒤엉킨 미래 도시.
기업은 국가보다 강력하며,
정보와 신체 개조가 권력이 된다.
빛나는 상층과 버려진 하층이 공존하며,
자유는 상품처럼 거래된다.
    `.trim(),

        background:
            "Neon-lit futuristic megacity at night, holographic signs flickering between skyscrapers, wet reflective asphalt streets, drones faintly visible in the distance, cyberpunk ambience, background depth blur",

        narrationGuide: {
            tone: "건조하고 빠르며 차가운 도시 감각이 도는 미래 서사",
            vocabulary: "네온, 신호, 감시, 층위, 데이터, 개조, 거래, 하층, 드론 같은 어휘를 선호",
            sentenceStyle: "짧은 문장으로 리듬을 만들고, 장면 전환은 빠르게 끊어 간다",
            imagery: "젖은 아스팔트, 번쩍이는 간판, 금속의 반사, 기계음 같은 시각과 소리 중심",
            forbidden: "목가적 비유, 고전 문체, 과한 감성 독백, 판타지식 장식"
        }
    },

    SYLVARIA: {
        id: "SYLVARIA",
        name: "실바리아",
        desc: "자연과 마법이 공존하는 엘프의 밀림.",

        longDesc: `
수천 년의 시간을 살아온 숲과 엘프들의 고향.
나무와 생명은 하나로 연결되어 있으며,
외부인의 발걸음은 숲 자체가 시험한다.
자연은 자비롭지만, 동시에 잔혹하다.
균형을 해치는 존재는 조용히 제거된다.
    `.trim(),

        background:
            "Ancient forest with towering trees blocking most sunlight, soft glowing magical symbols carved into bark, floating light particles in the air, tranquil and mystical atmosphere, subtle background blur",

        narrationGuide: {
            tone: "부드럽고 고요하지만 날카로운 균형 의식이 깔린 서사",
            vocabulary: "고목, 숨결, 결, 균형, 속삭임, 이끼, 문양, 빛결 같은 어휘를 선호",
            sentenceStyle: "문장을 조금 길게 늘여 여운을 만들되, 마지막은 단정하게 정리한다",
            imagery: "나뭇결, 이끼의 촉감, 반딧불의 점광, 축축한 공기 같은 자연 감각 중심",
            forbidden: "기계적 용어 남발, 거친 속어, 지나친 폭력적 묘사, 현대적 대화체"
        }
    },

    DEEP_FORGE: {
        id: "DEEP_FORGE",
        name: "이글대는 심부",
        desc: "불과 돌 속에서 살아가는 드워프의 화산 도시.",

        longDesc: `
활화산의 심부에 세워진 드워프들의 요새 도시.
용암은 에너지원이자 방어 수단이며,
모든 것은 채굴과 제련을 중심으로 돌아간다.
전통과 기술이 결합된 사회로,
외부인은 쉽게 신뢰받지 못한다.
    `.trim(),

        background:
            "A volcanic underground forge city, flowing lava channels illuminating stone bridges, glowing furnaces in the distance, red-orange ambient light, heavy stone structures fading into shadow, atmospheric depth",

        narrationGuide: {
            tone: "거칠고 단단하며 열기와 쇳소리가 섞인 공방 서사",
            vocabulary: "심부, 용암, 제련, 채굴, 석조, 대장간, 불꽃, 금속 같은 어휘를 선호",
            sentenceStyle: "짧고 힘 있게 끊어가며, 감각 묘사는 뜨거움과 진동 중심으로 붙인다",
            imagery: "붉은 불빛, 쇳가루 냄새, 망치의 울림, 뜨거운 공기 같은 촉감 중심",
            forbidden: "가벼운 감상, 지나친 화려한 수사, 현대적 유행어, 느슨한 문장"
        }
    }
};
