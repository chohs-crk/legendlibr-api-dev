import admin from "firebase-admin";

if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY
        );

        if (!serviceAccount.project_id) {
            throw new Error("Missing project_id in service account");
        }

        // ✅ 실제 Firebase 콘솔에 존재하는 버킷 이름
        const STORAGE_BUCKET = "mythticstory.firebasestorage.app";

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: STORAGE_BUCKET
        });

        console.log("✅ Firebase Admin Initialized:", serviceAccount.project_id);
        console.log("✅ Using Storage Bucket:", STORAGE_BUCKET);

    } catch (e) {
        console.error("❌ Firebase Admin Init Failed:", e);
        throw e;
    }
}

export { admin };
export const db = admin.firestore();
export const auth = admin.auth();
export const bucket = admin.storage().bucket();
