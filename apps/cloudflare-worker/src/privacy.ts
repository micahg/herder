const PRIVACY_POLICY_MARKDOWN = `# Privacy Policy

Last updated: March 17, 2026

This Privacy Policy explains how Steakholder Meating ("we", "us", or "our") handles information when you interact with our WhatsApp integration service (the "Service").

## 1. Scope

This policy applies to data processed through our WhatsApp webhook endpoint used to receive and validate WhatsApp Business Platform events.

## 2. Information We Process

When WhatsApp sends webhook events to our Service, we may process the following categories of information:

- WhatsApp message metadata (for example, sender WhatsApp ID, message ID, timestamps)
- Profile information provided in webhook payloads (for example, display name)
- Message content (for example, text body)
- Technical request data (for example, HTTP headers, IP-related network data)

## 3. How We Use Information

We process this information to:

- Verify webhook authenticity using cryptographic signature validation
- Operate and secure the Service
- Troubleshoot and monitor webhook delivery and system behavior

We do not sell personal data.

## 4. Logging and Retention

Our current implementation logs incoming webhook request headers and request body content for operational debugging and security validation.

- Log data may include personal data contained in WhatsApp webhook payloads.
- Logs are retained according to our Cloudflare and operational log retention settings.

If you want stricter minimization, we can reduce logging to only required metadata and error events.

## 5. Legal Basis (Where Applicable)

Depending on your location, our legal bases may include:

- Legitimate interests in securing and operating the Service
- Performance of a contract (when applicable)
- Compliance with legal obligations

## 6. Data Sharing

We may share data only with:

- Service providers that help us host and operate the Service (for example, Cloudflare)
- Authorities or regulators when required by law

We do not share personal data for third-party marketing.

## 7. International Transfers

Your information may be processed in countries other than your own, including where our service providers operate. Where required, we use appropriate safeguards for cross-border transfers.

## 8. Security

We use reasonable technical and organizational measures to protect information, including signature verification for incoming webhook requests. No method of transmission or storage is 100% secure.

## 9. Your Rights

Depending on your jurisdiction, you may have rights to access, correct, delete, or restrict processing of your personal data, and to object to certain uses.

To exercise your rights, contact us at [privacy@steakholdermeating.com].

## 10. Children's Privacy

Our Service is not directed to children under 13 (or the equivalent minimum age in your jurisdiction), and we do not knowingly collect personal data directly from children.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. We will post the updated version with a revised "Last updated" date.

## 12. Contact

Data Controller (if applicable): [Legal Entity Name]

Email: [privacy@steakholdermeating.com]
`;

export function privacyPolicyResponse(): Response {
  return new Response(PRIVACY_POLICY_MARKDOWN, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
