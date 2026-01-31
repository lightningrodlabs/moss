interface Env {
  GITHUB_TOKEN: string;
  FEEDBACK_BUCKET: R2Bucket;
}

interface FeedbackRequest {
  screenshot: string; // data:image/png;base64,...
  text: string;
  mossVersion: string;
  os: string;
}

const REPO_OWNER = 'lightningrodlabs';
const REPO_NAME = 'moss';
const R2_PUBLIC_URL = 'https://pub-98da085c523142129bcac92fdf2b7648.r2.dev';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'POST' || new URL(request.url).pathname !== '/feedback') {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    try {
      const body = (await request.json()) as FeedbackRequest;

      if (!body.text || !body.screenshot) {
        return new Response('Missing required fields: text, screenshot', {
          status: 400,
          headers: corsHeaders(),
        });
      }

      // Extract base64 content from data URL
      const base64Match = body.screenshot.match(/^data:image\/\w+;base64,(.+)$/);
      if (!base64Match) {
        return new Response('Invalid screenshot format', {
          status: 400,
          headers: corsHeaders(),
        });
      }
      const imageBase64 = base64Match[1];

      // Convert base64 to binary
      const imageBuffer = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

      // Upload screenshot to R2
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const imagePath = `feedback/${timestamp}-${randomSuffix}.png`;

      await env.FEEDBACK_BUCKET.put(imagePath, imageBuffer, {
        httpMetadata: {
          contentType: 'image/png',
        },
      });

      const imageUrl = `${R2_PUBLIC_URL}/${imagePath}`;

      // Create GitHub issue
      const titleText = body.text.length > 60 ? body.text.substring(0, 57) + '...' : body.text;
      const issueBody = `## Design Feedback

${body.text}

### Screenshot

![screenshot](${imageUrl})

### Environment
- **Moss version:** ${body.mossVersion || 'unknown'}
- **OS:** ${body.os || 'unknown'}

---
*Submitted via Moss Design Feedback Mode*`;

      const issueRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
        {
          method: 'POST',
          headers: ghHeaders(env.GITHUB_TOKEN),
          body: JSON.stringify({
            title: `[Design Feedback] ${titleText}`,
            body: issueBody,
            labels: ['design-feedback'],
          }),
        },
      );

      if (!issueRes.ok) {
        const err = await issueRes.text();
        console.error('GitHub issue creation failed:', err);
        return new Response(`Issue creation failed: ${issueRes.status}`, {
          status: 502,
          headers: corsHeaders(),
        });
      }

      const issueData = (await issueRes.json()) as {
        html_url: string;
        number: number;
      };

      return new Response(
        JSON.stringify({
          issueUrl: issueData.html_url,
          issueNumber: issueData.number,
        }),
        {
          status: 200,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        },
      );
    } catch (e) {
      console.error('Worker error:', e);
      return new Response('Internal error', {
        status: 500,
        headers: corsHeaders(),
      });
    }
  },
};

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Moss-Feedback-Worker',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
