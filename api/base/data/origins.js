// base/data/origins.js
// ⚠️ 서버 전용 — 클라이언트 절대 노출 금지

export const ORIGINS = {
    FERRUM_POLIS: {
        id: "FERRUM_POLIS",
        name: "철혈의 성계",
        desc: "비등하는 힘, 넘치는 피를 숭배하라",

        longDesc: `
페룸 폴리스는 ‘도시’가 아니라 하나의 무기다.
강철의 판재로 직각을 세우고, 성벽을 신전처럼 떠받든다.
이곳의 기사들은 왕을 섬기지 않는다. ‘날’과 ‘피’를 섬긴다.
전장은 제의가 되고, 결투는 기도문이 된다.
붉은 깃발 아래에서 살아남는 자만이, 힘이 곧 미덕임을 증명한다.
        `.trim(),

        background:
            "Angular iron city-state fortress, brutalist-gothic knight basilica silhouettes, crimson banners, blacksmith sparks and smoke, blood-red sunset sky, cinematic lighting, atmospheric depth, no crowd, slightly blurred background",

        narrationGuide: {
            tone: "철과 피의 신앙이 깔린, 냉혹하고 의식적인 기사 서사",
            vocabulary: "철혈, 강철, 날, 성벽, 제의, 서약, 결투, 성배, 망치, 핏빛 같은 어휘를 선호",
            sentenceStyle: "짧게 찍어 누르듯 전개하고, 의식·결투 장면에서는 문장을 한 번 더 반복해 주문처럼 리듬을 만든다",
            imagery: "각진 실루엣, 쇳내, 불꽃의 튐, 핏방울, 차가운 돌바닥의 감각을 중심",
            forbidden: "가벼운 농담, 현대 밈/유행어, 지나친 미화, 과도한 낭만화"
        }
    },

    NEON_DRIP: {
        id: "NEON_DRIP",
        name: "네온 드립",
        desc: "가득 찬 데이터가 도시의 동맥을 터뜨렸다.",

        longDesc: `
네온 드립의 도시는 숨 쉬는 대신 ‘흘러넘친다’.
데이터는 전선 속에만 머물지 않고, 광고와 감시망을 타고 골목까지 스민다.
과부하로 터진 신호가 거리의 빛을 물로 만들고, 물은 다시 네온이 되어 번진다.
기업의 로고는 국기처럼 걸리고, 시민의 기억은 거래 단위가 된다.
살아남으려면 연결을 끊어야 한다. 하지만 이곳에서 끊긴 자는 곧 사라진다.
        `.trim(),

        background:
            "Cyberpunk dystopian megacity at night, neon signs bleeding like liquid data, overloaded holograms glitching, wet reflective streets, surveillance drones in haze, dense cables and high-rise shadows, cinematic, depth blur, no crowd",

        narrationGuide: {
            tone: "건조하고 빠르며 불안정한, 디스토피아 도시 감각의 서사",
            vocabulary: "네온, 누수, 과부하, 신호, 감시, 데이터, 거래, 계정, 하층, 글리치, 핫픽스 같은 어휘를 선호",
            sentenceStyle:
                "짧은 문장으로 박자를 만들고, 장면 전환은 끊어 치며, 중요한 문장에는 ‘딱 한 번’ 냉정한 단정을 넣는다",
            imagery: "젖은 아스팔트 반사, 번지는 빛, 끊기는 전파, 금속의 차가움, 기계음과 경고음 중심",
            forbidden: "목가적 비유, 과도한 감성 독백, 판타지식 장식, 장황한 기술 해설"
        }
    },

    EDEN_CINERIS: {
        id: "EDEN_CINERIS",
        name: "저문 에덴",
        desc: "낙원의 잿더미에서, 금기의 주술이 다시 꽃핀다.",

        longDesc: `
에덴 시네리스는 한때 ‘낙원’이라 불렸다.
그러나 신성의 정원은 불타고, 지금은 재가 눈처럼 내리는 폐원만이 남았다.
남은 자들은 기도 대신 주술을 택했다. 금기를 찢어 생명을 꿰매고, 죽음을 돌려세운다.
주문은 꽃잎이 아니라 뼈와 잉크로 기록되며, 의식은 향기 대신 탄내를 남긴다.
이곳에서 구원은 없다. 다만, 잿빛 세계를 움직이는 ‘대가’만이 있다.
        `.trim(),

        background:
            "Dark occult garden in ash-covered ruins, blackened trees like twisted thorns, floating forbidden runes, bone-and-ink grimoires, cold violet fire, crimson moonlight through smoke, cinematic, misty depth, slightly blurred background, no figures",

        narrationGuide: {
            tone: "속삭이듯 낮고 의식적인, 금기와 대가가 중심인 흑마법 서사",
            vocabulary: "금기, 주술, 의식, 제물, 잿가루, 봉인, 룬, 서고, 사령, 잉크, 대가 같은 어휘를 선호",
            sentenceStyle:
                "문장을 길게 끌지 않고 낮은 호흡으로 이어가며, 마지막 문장에 ‘대가’ 혹은 ‘균열’을 남겨 여운을 만든다",
            imagery: "재가 날리는 공기, 탄내, 차가운 불꽃, 뼈의 질감, 어둠 속 문양의 미세한 발광 중심",
            forbidden: "밝은 희극, 과장된 영웅담, 현대적 기술 용어 남발, 선정적·가벼운 주술 표현"
        }
    },

    ORIGO_PRIMUS: {
        id: "ORIGO_PRIMUS",
        name: "프리무스",
        desc: "최초의 근원에서 흘러내린 성광이, 모든 존재의 자리를 정한다.",

        longDesc: `
오리고 프리무스는 하늘 위에 있는 땅이 아니라, 하늘 그 자체의 ‘뿌리’다.
구름은 계단이 되고, 빛은 문장이 되어 성역의 기둥을 세운다.
성자들은 검이 아니라 서약을 들고 싸운다. 한 번 맺은 맹세는 세계의 법이 된다.
은총은 자비로 보이지만, 그 빛은 불순물을 남기지 않는다.
여기서 인간은 질문을 배운다. “나는 근원에 합당한가.”
        `.trim(),

        background:
            "Sacred sky realm above the clouds, floating alabaster temples and golden arches, radiant holy light beams, serene blue-white atmosphere, distant choir-like glow, wind-swept banners, cinematic, soft diffusion, no figures",

        narrationGuide: {
            tone: "정제되고 장엄하며 맑은 공기가 감도는, 성역·성자 중심의 서사",
            vocabulary: "근원, 성광, 서약, 계시, 은총, 성자, 순례, 정결, 심판, 성가, 천궁 같은 어휘를 선호",
            sentenceStyle:
                "문장을 과하게 흥분시키지 않고 균형 있게 유지하며, 결론은 마지막 한 문장으로 단정해 준다",
            imagery: "유백색 빛, 차가운 바람, 종소리의 잔향, 구름의 결, 금빛 반사 같은 청명한 이미지",
            forbidden: "속된 농담, 노골적 잔혹 묘사, 무분별한 속어, 지나친 신비주의 과잉설명"
        }
    },

    GIANTS_DREAM: {
        id: "GIANTS_DREAM",
        name: "거인의 꿈",
        desc: "가장 작은 이의 누구보다 거대한 꿈이 세계를 창제했다.",

        longDesc: `
이 세계는 ‘현실’이 아니라, 누군가의 꿈이 굳어 만들어진 풍경이다.
산맥은 숨결의 굴곡에서 태어났고, 바다는 한 번의 울음이 퍼져 남은 흔적이다.
기적은 법칙을 깨지 않는다. 그저, 법칙이 꿈을 따라 조용히 모양을 바꿀 뿐이다.
사람들은 밤마다 하늘에 귀를 기울인다. 거인이 뒤척이면, 내일의 지도가 달라진다.
그리고 가장 용감한 자들은 꿈속으로 걸어 들어가, 세계의 다음 장면을 ‘선택’한다.
        `.trim(),

        background:
            "Surreal dreamscape landscape, floating islands and impossible geometry, soft starlight mist, a distant colossal sleeping silhouette in clouds, luminous butterflies and miracle-like light particles, painterly fantasy, cinematic, gentle depth blur",

        narrationGuide: {
            tone: "몽환적이고 따뜻하며, 경이와 쓸쓸함이 함께 흐르는 기적 서사",
            vocabulary: "꿈결, 환상, 기적, 속삭임, 심상, 별빛, 파편, 문, 뒤척임, 선택 같은 어휘를 선호",
            sentenceStyle: "문장을 조금 길게 늘여 흐름을 만들되, 마지막은 짧게 끊어 ‘깨달음’처럼 남긴다",
            imagery: "안개처럼 번지는 빛, 색이 스며드는 공기, 둥실 뜨는 질감, 현실이 느슨해지는 감각 중심",
            forbidden: "과도한 냉소, 딱딱한 과학적 설명, 잔혹함의 남발, 지나친 장황한 설정 나열"
        }
    },

    KIZUNA_RESONANCE: {
        id: "KIZUNA_RESONANCE",
        name: "키즈나 레조넌스",
        desc: "감정의 파동이 물리적 병기가 되는 시대, 청춘들은 세계를 위협하는 ‘공허’에 맞서 자신들의 청춘을 연소시킨다.",

        longDesc: `
키즈나 레조넌스의 전장은 거리도, 전선도 아니다. 마음이다.
웃음과 분노, 두려움과 다짐이 ‘파동’이 되어 실체를 얻고, 무기와 장갑으로 응결한다.
청춘들은 공명 장치가 달린 교복을 입고, 서로의 감정을 맞물려 더 큰 힘을 끌어낸다.
하지만 공명은 대가를 요구한다. 감정이 타오를수록, 남는 것은 공허에 가까운 잔향.
그럼에도 그들은 달린다. ‘유대’가 사라지는 순간, 세계도 함께 꺼지기 때문에.
        `.trim(),

        background:
            "Japanese anime key visual style, modern city skyline at dusk, school rooftop and distant train lines, bright resonance wave patterns in the sky, subtle sakura petals in wind, glowing energy weapon silhouettes, dramatic clouds, cinematic, depth blur, no crowd",

        narrationGuide: {
            tone: "뜨겁고 직진하는 청춘 서사, 진지함 속에 반짝이는 유머가 조금 섞인 톤",
            vocabulary: "유대, 공명, 레조넌스, 파동, 각성, 동료, 청춘, 전력, 오버드라이브, 공허, 잔향 같은 어휘를 선호",
            sentenceStyle:
                "대사는 자연스럽고 빠르게, 내레이션은 짧게 상황을 끊어 주며, 클라이맥스에서는 감정을 한 단계 끌어올린다",
            imagery: "번쩍이는 이펙트, 바람에 흔들리는 머리카락·리본, 심장 박동 같은 리듬, 하늘색과 석양빛 대비",
            forbidden: "지나친 냉소, 과도한 잔혹·고어, 과장된 아재개그, 난해한 철학 설교"
        }
    },

    WYVERN_JURASSIC: {
        id: "WYVERN_JURASSIC",
        name: "와이번 쥬라기",
        desc: "공룡과 용이 싸우면 누가 이길까?",

        longDesc: `
와이번 쥬라기의 대지는 아직 ‘문명’이라는 이름을 모른다.
정글은 숨을 삼키고, 화산은 낮에도 붉게 숨을 내쉰다.
거대한 공룡들의 발자국이 강줄기를 바꾸고, 하늘에서는 와이번이 포효하며 그림자를 던진다.
사냥과 도망, 둥지와 알, 불꽃과 이빨. 모든 규칙은 힘으로 새겨진다.
그리고 질문은 단 하나다. 땅의 왕좌인가, 하늘의 왕좌인가.
        `.trim(),

        background:
            "Prehistoric jungle valley at dawn, massive dinosaurs roaming near a river, wyverns flying overhead with wide shadows, distant volcano emitting smoke, lush ferns and ancient trees, cinematic epic scale, atmospheric haze, depth blur, no humans",

        narrationGuide: {
            tone: "원초적이고 박진감 넘치며, 생존의 공포와 경이가 공존하는 서사",
            vocabulary: "원시, 포효, 발자국, 비늘, 둥지, 사냥, 창, 불꽃, 이빨, 왕좌, 천둥 같은 어휘를 선호",
            sentenceStyle: "동사는 강하게, 문장은 짧게. 위압적인 장면에서는 리듬을 끊어 긴장을 만든다",
            imagery: "진흙의 질감, 뜨거운 숨결, 거대한 그림자, 날카로운 발톱, 나뭇잎이 찢기는 소리 중심",
            forbidden: "현대 기술/도시 표현, 과학적 분류 설명 과다, 가벼운 농담, 지나친 로맨스 중심 전개"
        }
    }
};