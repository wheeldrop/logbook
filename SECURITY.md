# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this package, report it through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/wheeldrop/logbook/security) of this repository
2. Click **"Report a vulnerability"**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)

### What to expect

- Confirmation that your report was received
- Regular updates on fix progress
- Credit in the advisory unless you prefer to remain anonymous
- CVE request for confirmed vulnerabilities when appropriate

## Security Best Practices

When using this MCP server:

1. **Run locally only** — the server uses stdio transport and reads data from your local filesystem. Do not expose it over a network
2. **Review file access** — the server reads AI agent conversation data from well-known paths (`~/.claude`, `~/.codex`, `~/.gemini`). It does not write to these directories
3. **Keep dependencies updated** and run `npm audit` regularly
4. **Protect your conversation data** — conversation logs may contain sensitive information (API keys, credentials, internal URLs) that appeared in your coding sessions
