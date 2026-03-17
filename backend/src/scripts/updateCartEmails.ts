import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const updates: Array<{
  id: string;
  title: string;
  customer_name: string;
  customer_email: string;
  copy: string;
  recommended_product: string;
  priority: 'high' | 'medium' | 'low';
  products: string;
}> = [
  {
    id: 'b022432f-b6eb-472b-9ac3-4887a4cb3be2',
    title: 'Laura, la Tarta de Cumpleaños',
    customer_name: 'Laura Prieto Garcia',
    customer_email: 'lauraprieto@gmail.com',
    copy: 'Laura, la Tarta de Cumpleaños no es una tarta cualquiera. Sin gluten, artesanal, y si la pruebas con la Caja Merienda tienes el combo perfecto. Pero ojo, la Caja Merienda crea adicción.',
    recommended_product: 'CAJA MERIENDA',
    priority: 'high',
    products: 'TARTA DE CUMPLEAÑOS (12 porciones), CAJA MERIENDA (9 unidades)',
  },
  {
    id: 'dd25093a-fca3-42db-be52-98ea93123937',
    title: 'Tamar, que no se te escape',
    customer_name: 'Tamar Valdenebro',
    customer_email: 'tvbenet@gmail.com',
    copy: 'Tamar, el Volcán de Chocolate y la Tarta de Queso juntos es la combinación que más nos piden. Y todo sin gluten, que eso aquí no se negocia. Avísanos antes de que te arrepientas de no haberlo hecho.',
    recommended_product: '',
    priority: 'high',
    products: 'VOLCÁN DE CHOCOLATE, TARTA DE QUESO, VELAS DORADAS x2',
  },
  {
    id: '6fd44733-48e8-4d0f-b8f3-0db3649e46d4',
    title: 'Leticia, dos porciones y una advertencia',
    customer_name: 'Leticia Scandella Ruiz-vernacci',
    customer_email: 'letscandella@hotmail.com',
    copy: 'Leticia, las porciones son ideales para probar sin compromiso. Eso sí, aviso: la mayoría acaba volviendo a por la tarta entera. La de limón y la de zanahoria son las culpables.',
    recommended_product: 'TARTA DE LIMÓN, TARTA DE ZANAHORIA',
    priority: 'high',
    products: 'PORCIONES TARTAS x2',
  },
  {
    id: '61e10184-c698-43b0-8a38-f1cd587179ca',
    title: 'Anna, cuatro donas sin gluten',
    customer_name: 'Anna VALDIVIESO',
    customer_email: 'annavaldi@icloud.com',
    copy: 'Anna, la Dona Kinder engancha. Y si juntas la de Banana con la de Peanut en el mismo bocado... bueno, no decimos nada. Todo sin gluten, todo artesanal, todo peligrosamente bueno.',
    recommended_product: '',
    priority: 'medium',
    products: 'DONA KINDER, DONA PEANUT REESE, DONA BANANA CROC, DONA RAFAELLO',
  },
  {
    id: '4b97b285-1c4f-48d1-8282-c992c7498a93',
    title: 'Lorena, sobre la Tarta Bebé',
    customer_name: 'Lorena Pereira',
    customer_email: 'pereira.lorena@gmail.com',
    copy: 'Lorena, la Tarta Bebé es de lo más especial que sale de nuestro horno. Sin gluten, ingredientes naturales, y hecha con mucho mimo. Si la necesitas para una fecha, avísanos con tiempo porque se hace por encargo.',
    recommended_product: '',
    priority: 'medium',
    products: 'TARTA BEBÉ',
  },
  {
    id: '1fbc09ad-0f37-48c3-a2dc-5e28b14b9ecf',
    title: 'Paola, cuidado con la Caja Merienda',
    customer_name: 'Paola Serrano',
    customer_email: 'paosealc@gmail.com',
    copy: 'Paola, la Caja Merienda tiene un poco de todo y eso es lo peligroso — no puedes parar. La Dona Kinder con su crema de avellana tampoco ayuda. Si encima pruebas el Volcán de Chocolate, ya no hay vuelta atrás.',
    recommended_product: 'VOLCÁN DE CHOCOLATE',
    priority: 'medium',
    products: 'CAJA MERIENDA (9 unidades), DONA KINDER',
  },
  {
    id: 'aad6ce41-33a6-48d1-836d-333c4b086e2b',
    title: 'Sergio, una advertencia sobre el Volcán',
    customer_name: 'Sergio García',
    customer_email: 'sgarcia@bdibiotech.com',
    copy: 'Sergio, el Volcán de Chocolate es de los más pedidos por algo. Chocolate puro, sin gluten, y cuando lo cortas... bueno, ya lo verás. Si te va el chocolate, la Cookie XXL de chocolate y avellanas también es de las que no duran.',
    recommended_product: 'Cookie XXL de Chocolate y Avellanas',
    priority: 'medium',
    products: 'VOLCÁN DE CHOCOLATE',
  },
  // Cecilia (#8) skipped — already sent
  {
    id: 'a398d880-e65e-4502-8784-1ddb1487bf77',
    title: 'Daniela, la Tarta de Queso',
    customer_name: 'Daniela Tapia',
    customer_email: 'espartanogameraura@gmail.com',
    copy: 'Daniela, la Tarta de Queso es de las que más nos repiten. Sin gluten y artesanal, como todo lo nuestro. Si quieres probar algo diferente, la Hogaza de Pasas y Nueces sorprende — no parece sin gluten.',
    recommended_product: 'HOGAZA PASAS Y NUECES',
    priority: 'low',
    products: 'TARTA DE QUESO',
  },
  {
    id: 'c6feb5cc-c43a-4935-a78d-708056f10b4d',
    title: 'Ana, buena selección',
    customer_name: 'Ana Flo',
    customer_email: 'anaflo86@hotmail.com',
    copy: 'Ana, tienes buen ojo — pan, crackers, bizcocho y la Cookie XXL. La Cookie es de las que desaparecen rápido en casa, aviso. Y si un día te apetece algo dulce de verdad, la Tarta de Zanahoria es de las que no te esperas.',
    recommended_product: 'TARTA DE ZANAHORIA',
    priority: 'low',
    products: 'PAN DE MOLDE SEMILLAS, CRACKERS NATURAL, BIZCOCHO DE LA CASA, Cookie XXL de Chocolate y Avellanas',
  },
  {
    id: 'c9446f8a-bdbc-4e8c-b97d-e7502bfd9f24',
    title: 'Miriam, tienes el desayuno resuelto',
    customer_name: 'Miriam Lopez Martin',
    customer_email: 'miriamlopezmartin@icloud.com',
    copy: 'Miriam, con la Granola y las Tortitas tienes desayunos para toda la semana. Las Cookies son las típicas que compras para compartir pero acabas comiéndotelas tú. Si un día quieres cambiar a algo más contundente, la Tarta de Limón no falla.',
    recommended_product: 'TARTA DE LIMÓN',
    priority: 'low',
    products: 'GRANOLA, TORTITAS, COOKIES CHOCOLATE x3, COOKIE PEPITAS CHOCOLATE x3, PALMERITAS DE HOJALDRE, BIZCOCHO MARMOLADO',
  },
];

async function main() {
  let ok = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('pending_comms')
      .update({
        content: {
          customer_name: u.customer_name,
          customer_email: u.customer_email,
          title: u.title,
          copy: u.copy,
          products: u.products,
          recommended_product: u.recommended_product,
          priority: u.priority,
        },
      })
      .eq('id', u.id);

    if (error) {
      console.log(`✗ ${u.customer_name}: ${error.message}`);
    } else {
      ok++;
      console.log(`✓ ${u.customer_name}`);
    }
  }
  console.log(`\nDone: ${ok}/${updates.length} updated`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
