// /api/_utils/setCors.js

export function setCors(req, res) {
    const origin = req.headers.origin;
    const allowedOrigin = process.env.APP_ORIGIN || "https://legendlibr.web.app";

    // 브라우저 요청이고, 허용되지 않은 origin이면 차단
    if (origin && origin !== allowedOrigin) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "INVALID_ORIGIN" }));
        return false;
    }

    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
    res.setHeader("Vary", "Origin");

    // preflight 요청은 여기서 종료
    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return false;
    }

    return true; // 계속 진행해도 됨
}
