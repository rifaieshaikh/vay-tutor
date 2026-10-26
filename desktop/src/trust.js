function hostHostname(origin) {
  return new URL(origin).hostname.toLowerCase();
}

function certificateDecision(requestHostname, trustedHostname) {
  const request = String(requestHostname || "").toLowerCase();
  const trusted = String(trustedHostname || "").toLowerCase();
  if (trusted && request === trusted) return 0;
  return -3;
}

module.exports = { hostHostname, certificateDecision };
