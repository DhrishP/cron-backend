import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const domain = process.argv[2];

if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}

if (!domain) {
  console.error('Usage: npm run set-webhook <https://your-vercel-domain.vercel.app>');
  process.exit(1);
}

const cleanDomain = domain.replace(/\/+$/, '');
const webhookUrl = `${cleanDomain}/api/webhooks/telegram`;

async function setWebhook() {
  console.log(`Setting Telegram webhook to: ${webhookUrl}...`);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    const data = await res.json();
    console.log('Telegram API response:', data);
    if (data.ok) {
      console.log('✅ Telegram Webhook successfully connected to Vercel!');
    } else {
      console.error('❌ Failed to set webhook:', data.description);
    }
  } catch (err) {
    console.error('❌ Error setting webhook:', err);
  }
}

setWebhook();
