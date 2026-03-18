import 'dotenv/config';
import { sendPushNotification } from '../services/pushNotifier.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  console.log('Sending test push to Andrea...');
  try {
    await sendPushNotification(ANDREA_ID, {
      title: 'Test de Sillages',
      body: 'Si ves esto, las notificaciones funcionan correctamente.',
      url: '/actions',
    });
    console.log('✅ Push sent successfully (no error thrown)');
  } catch (err) {
    console.error('❌ Push FAILED:', err);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
