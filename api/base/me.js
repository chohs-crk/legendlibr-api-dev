import { withApi } from "../_utils/withApi.js";

export default withApi("protected", async (req, res, { uid }) => {
    return res.json({ uid });
});