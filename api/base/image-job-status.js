import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { applyUserMetaDelta } from "./_internal/user-meta-update.js";

export default withApi(
    // ⚠️ withApi가 "expensive"만 허용하는 프로젝트면 "expensive"로 바꿔줘
    "cheap",
    async (req, res, { uid }) => {

        const jobId =
            (req.query?.id || req.query?.jobId || "").toString().trim();

        if (!jobId) {
            return res.status(400).json({ ok: false, error: "MISSING_JOB_ID" });
        }

        const jobRef = db.collection("imageJobs").doc(jobId);
        const snap = await jobRef.get();

        if (!snap.exists) {
            return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });
        }

        const job = snap.data();

        if (job.uid !== uid) {
            return res.status(403).json({ ok: false, error: "NOT_OWNER" });
        }

        // ✅ (옵션) 환불 처리: Function이 error + refund.suggested=true로 찍어두면
        // polling 중에 여기서 refund 적용.
        let userMeta = null;

        const refund = job?.billing?.refund;
        if (
            job.status === "error" &&
            refund?.suggested === true &&
            !refund?.appliedAt &&
            Number(refund?.frames || 0) > 0
        ) {
            try {
                userMeta = await applyUserMetaDelta(uid, {
                    frameDelta: Math.abs(Number(refund.frames))
                });

                await jobRef.update({
                    updatedAt: Date.now(),
                    "billing.refund.appliedAt": Date.now()
                });

            } catch (e) {
                // 환불 실패해도 polling 자체는 응답해야 함
                console.error("REFUND_FAILED:", e);
            }
        }

        return res.json({
            ok: true,
            id: snap.id,
            status: job.status,
            imageUrl: job.imageUrl || null,
            result: job.result || null,
            error: job.error || null,
            billing: job.billing || null,
            userMeta
        });
    }
);