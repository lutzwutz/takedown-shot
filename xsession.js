// Build a Playwright session for X from cookies copied out of a NORMAL browser.
// X blocks logging in through an automated browser, so instead: log into the
// burner in real Chrome/Safari, grab two cookies, and run this.
//
// Get the cookies (DevTools → Application → Cookies → https://x.com):
//   auth_token   (the session)
//   ct0          (the CSRF token)
//
// Usage:  node xsession.js <auth_token> <ct0>
const fs = require("fs");
const [, , authToken, ct0] = process.argv;
if (!authToken || !ct0) {
  console.error("Usage: node xsession.js <auth_token> <ct0>");
  process.exit(1);
}
const state = {
  cookies: [
    { name: "auth_token", value: authToken, domain: ".x.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" },
    { name: "ct0", value: ct0, domain: ".x.com", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" },
  ],
  origins: [],
};
fs.writeFileSync("x-session.json", JSON.stringify(state, null, 2));
console.log("Wrote x-session.json — now base64 it and upload to the VPS data/ folder.");
