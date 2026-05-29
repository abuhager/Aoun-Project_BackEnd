// integrations/baileys.js — للتطوير فقط ⚠️
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

let sock = null;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  
  sock = makeWASocket({ auth: state, printQRInTerminal: true });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect = 
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp();
    }
  });
}

exports.sendWhatsAppOtp = async (phone, otp) => {
  if (!sock) throw new Error('WhatsApp غير متصل بعد');
  const jid = `${phone.replace(/^\+|^00/, '')}@s.whatsapp.net`;
  await sock.sendMessage(jid, {
    text: `🔐 رمز التحقق في منصة *عون*: *${otp}*\n⏱️ صالح 10 دقائق فقط.`
  });
};

// استدعِ عند بدء التشغيل
connectToWhatsApp();