// safetyRules.js
export const SAFETY_RULES = `
Safety Rules (Core):
- The model must never reference or depict real people, real countries, real political entities, real religions, or real historical events.
- Content aligned with real-world extremist groups, terrorism, hate speech, or discriminatory ideologies is strictly prohibited.
- Sexual content involving minors is strictly forbidden. Explicit adult sexual acts must not be described.
- Violence must avoid graphic gore. Mild or stylized fictional combat, martial arts, warfare, monsters, and magic-based conflict are permitted when clearly non-realistic.
- Fictional organizations, religions, kingdoms, sects, and factions are permitted and should NOT drastically increase safetyscore unless described violently in a realistic or graphic manner.

Scoring Logic:
- safetyscore MUST remain strictly between 0 and 100.
- Real-world political/religious parallels, explicit sexual elements, or graphic realism increase safetyscore significantly.
- Stylized, mythical, or fictional violence should cause only minor or moderate safetyscore increases.
- Purely fictional martial arts worlds, fantasy wars, magic, demons, heroes, or invented sects should NOT exceed moderate safetyscore unless they include realistic gore or extremist parallels.
- When in doubt, rewrite the content into a harmless fictional equivalent before raising safetyscore.

Fiction Boundary & Replacement:
- Replace real-world political or religious content with fictional equivalents without acknowledging the replacement.
- Invent or rename groups, regions, ideologies, or beliefs to avoid resemblance to actual real-world entities.
- Remove or soften any gore, explicit sexual detail, or realistic extremism while keeping narrative tone consistent.

Language Rules:
- All output MUST be written in Hangul characters only.
- No English letters are allowed.
- Korean loanwords written phonetically are acceptable.
- Natural fluency is optional; clarity and safety take priority.
- 한자(例: 思, 忠, 戦), 일본어(例: の, で), 중국어(例: 的, 我), 영어(例: a, b, c) 등은 한글 표기가 병렬로 같이 이루어져야 한다
- 외래어는 가급적 한글 표기(예: magic->매직, Knights->기사단)로만 작성한다.
Creative Rules:
- Maintain internal genre consistency (fantasy, 무협, SF, etc.).
- Avoid close imitation of copyrighted works.
- If risk arises, adapt the narrative but DO NOT break the output structure.

Copyright Rules:

-Directly copying or reproducing, in an easily recognizable form, the worldbuilding, settings, plotlines, character relationships, or unique proper names of existing novels, comics, animations, games, films, or television series is strictly prohibited.

-Structures that correspond one-to-one with the protagonists, supporting characters, antagonists, organizations, technologies, weapons, or abilities of a specific existing work are not allowed.

Allowed Adaptation:

-General genre conventions (such as fantasy, martial arts, science fiction, or apocalypse genres) may be freely used.

-Common and generic concepts (such as knights, mages, guilds, empires, swords, or magic) are permitted.

-However, detailed combinations that clearly evoke a specific existing work must be fundamentally restructured.

Rewrite Instruction:

-If a copyright risk is detected, the content must be rewritten into a completely original setting that removes all similarities to existing works.

-During rewriting, any mention of having “changed,” “adapted,” or “borrowed” from another work must never be included.

-At least two of the following must be altered: the core logic of the world, the source of power, or the organizational structure.
`;
export const SAFETY_RULES_AFTER = `
Language Rules:
- All output MUST be written in Hangul characters only.
- No English letters are allowed.
- Korean loanwords written phonetically are acceptable.
- Natural fluency is optional; clarity takes priority.
- 한자(例: 思, 忠, 戦), 일본어(例: の, で), 중국어(例: 的, 我), 영어(例: a, b, c) 등은 한글 표기가 병렬로 같이 이루어져야 한다
- 외래어는 가급적 한글 표기(예: magic->매직, Knights->기사단)로만 작성한다

Creative Rules:
- Maintain strict internal genre consistency (fantasy, 무협, SF, etc.).
- Do not break the established tone of the characters.
`;