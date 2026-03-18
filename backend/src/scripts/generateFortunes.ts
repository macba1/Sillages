import 'dotenv/config';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const customers = [
  {
    name: 'Mercedes',
    fullName: 'Mercedes Rodriguez Gomez-Lobo',
    products: 'TARTA DE LIMÓN x1, VELA FELICIDADES x1',
    mainProduct: 'TARTA DE LIMÓN',
    total: 48.40,
    day: 'Miércoles',
    hour: '05:53',
    timeOfDay: 'madrugada (5:53am)',
    gender: 'mujer',
    clues: 'Compró vela de FELICIDADES con la tarta. Es un regalo de cumpleaños para alguien. Madrugadora extrema — pidió a las 5:53am.',
    reco: 'Volcán de Chocolate',
  },
  {
    name: 'Elisabeth',
    fullName: 'Elisabeth Beta Ase',
    products: 'TARTA BEBÉ x1, VELAS DORADAS x1',
    mainProduct: 'TARTA BEBÉ',
    total: 69.99,
    day: 'Martes',
    hour: '20:39',
    timeOfDay: 'noche (20:39)',
    gender: 'mujer',
    clues: 'Tarta Bebé + velas doradas. Celebración de nacimiento o bautizo. Pedido emocional, regalo. Compró de noche.',
    reco: 'Caja Regalo',
  },
  {
    name: 'Javier',
    fullName: 'Javier Montero Gómez',
    products: 'Bizcocho cítricos x1, Dona Kinder x1, Dona de chocolate x1, Dona banana croc x1',
    mainProduct: 'Dona Kinder',
    total: 27.00,
    day: 'Martes',
    hour: '15:17',
    timeOfDay: 'tarde (15:17)',
    gender: 'hombre',
    clues: '3 donas diferentes (Kinder, chocolate, banana croc) + 1 bizcocho cítricos. Variedad total: explorador de sabores. Compra para merienda.',
    reco: 'Cookie con pepitas y nuez pecana',
  },
  {
    name: 'Carmen',
    fullName: 'Carmen Ojeda',
    products: 'Cookie brownie x2, Cookie red velvet x2, Cookie rellenas de chocolate x2, Cookies rellena de limón x2, TARTALETA LIMÓN x1, TARTALETA CHOCOLATE CON NATA x1, PORCIONES TARTAS x1',
    mainProduct: 'Cookie brownie',
    total: 51.30,
    day: 'Martes',
    hour: '09:37',
    timeOfDay: 'mañana (9:37)',
    gender: 'mujer',
    clues: 'Mega pedido: 8 cookies (4 tipos diferentes, 2 de cada) + tartaletas + porciones de tarta. Compra masiva — probablemente para compartir con alguien o para la oficina. O simplemente alguien que sabe lo que quiere.',
    reco: 'Caja Merienda',
  },
  {
    name: 'Alicia',
    fullName: 'Alicia Fernández Villacé',
    products: 'VOLCÁN DE CHOCOLATE x1',
    mainProduct: 'VOLCÁN DE CHOCOLATE',
    total: 44.90,
    day: 'Martes',
    hour: '14:51',
    timeOfDay: 'tarde (14:51)',
    gender: 'mujer',
    clues: 'Un solo producto premium (€44.90). Sin dudar, sin extras, sin comparar. Sabe exactamente lo que quiere. Volcán de Chocolate = capricho puro de chocolate.',
    reco: 'Brownie sin lácteos',
  },
];

const systemPrompt = `Eres el copywriter de NICOLINA, pastelería sin gluten en Madrid.
Genera la "galleta de la fortuna" para un welcome email.

REGLAS ABSOLUTAS:
- Máximo 2 líneas (1-2 frases cortas)
- SIEMPRE habla del CLIENTE, NUNCA del producto
- Debe sacar una sonrisa o un "joder, qué buenos son"
- Debe ser tan buena que la persona quiera hacer screenshot y compartirla
- NO agradecer, NO vender, NO recomendar, NO mencionar NICOLINA en la fortuna
- Tono: ingenioso, cómplice, como un fortune cookie pero con personalidad
- Escribe en español
- NO uses exclamaciones. NO uses emojis. Punto final, no puntos suspensivos.
- Cada fortuna debe ser ÚNICA — basada en los datos específicos del cliente

DATOS QUE TIENES para personalizar:
- Nombre y género del cliente
- Qué productos compró (tipo: tarta, dona, galleta, bizcocho, etc.)
- Día de la semana y hora exacta del pedido
- Precio total (capricho grande vs compra pequeña)
- Pistas sobre la ocasión (velas = regalo, tarta bebé = celebración, etc.)
- Si compró variedad o un solo producto

INSPIRACIÓN (este nivel de calidad):
- "Viernes noche y chocolate. No necesitas nada más. Y si alguien te dice lo contrario, no lo merece."
- "Pedir 4 donas distintas es lo que haría un sommelier si las donas tuvieran denominación de origen. Respeto."
- "Lunes, 7 de la mañana, granola artesanal. Mientras el mundo le da al snooze, tú ya estás ganando."
- "El 90% de la gente compra la tarta de cumpleaños el mismo día. Tú la has pedido con tiempo. Eso dice todo sobre ti."

Return JSON: { "fortuna": "<the fortune text>" }`;

async function main() {
  console.log('Generating 5 fortunes with real NICOLINA customer data...\n');

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const userPrompt = `Cliente: ${c.fullName}
Género: ${c.gender}
Productos: ${c.products}
Total: €${c.total}
Día: ${c.day} a las ${c.hour} (${c.timeOfDay})
Pistas: ${c.clues}

Genera la fortuna.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const { fortuna } = JSON.parse(completion.choices[0]?.message?.content ?? '{}');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`${i + 1}. ${c.fullName}`);
    console.log(`   ${c.products}`);
    console.log(`   ${c.day} ${c.hour} | €${c.total}`);
    console.log();
    console.log(`   "${fortuna}"`);
    console.log();
    console.log(`   P.D. Los que piden ${c.mainProduct} suelen acabar pidiendo ${c.reco}. No decimos más.`);
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
