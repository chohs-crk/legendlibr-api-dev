import admin from "firebase-admin";

// ✅ 이미 초기화되어 있으면 그대로 재사용
if (!admin.apps.length) {
    try {
        // ✅ 환경변수에서 service account JSON 불러오기
        const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY
        );

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: "legendlibr.firebasestorage.app" // 🔥 이게 진짜
        });



        console.log("✅ Firebase Admin Initialized");

    } catch (e) {
        console.error("❌ Firebase Admin Init Failed:", e);
        throw new Error("Firebase Admin Init Error");
    }
}

// ✅ Firestore & Auth export
export { admin };
export const db = admin.firestore();
export const auth = admin.auth();
