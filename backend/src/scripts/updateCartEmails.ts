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
    title: 'Laura, sobre la Tarta de Cumpleaños',
    customer_name: 'Laura Prieto Garcia',
    customer_email: 'lauraprieto@gmail.com',
    copy: 'Laura, la Tarta de Cumpleaños lleva un bizcocho esponjoso con cobertura de crema suave. Todo sin gluten. Si además te gusta picar algo dulce, la Granola con avena dorada y almendras tostadas es perfecta al día siguiente con un yogur.',
    recommended_product: 'GRANOLA',
    priority: 'high',
    products: 'TARTA DE CUMPLEAÑOS (12 porciones), CAJA MERIENDA (9 unidades)',
  },
  {
    id: 'dd25093a-fca3-42db-be52-98ea93123937',
    title: 'Tamar, el Volcán o la Tarta de Queso',
    customer_name: 'Tamar Valdenebro',
    customer_email: 'tvbenet@gmail.com',
    copy: 'Tamar, el Volcán de Chocolate tiene un centro caliente que fluye espeso cuando lo cortas. La Tarta de Queso es lo contrario — cremosa, densa, con un toque ácido que equilibra. No hace falta elegir, la verdad.',
    recommended_product: '',
    priority: 'high',
    products: 'VOLCÁN DE CHOCOLATE, TARTA DE QUESO, VELAS DORADAS x2',
  },
  {
    id: '6fd44733-48e8-4d0f-b8f3-0db3649e46d4',
    title: 'Leticia, algo sobre las porciones',
    customer_name: 'Leticia Scandella Ruiz-vernacci',
    customer_email: 'letscandella@hotmail.com',
    copy: 'Leticia, las porciones son perfectas para probar sin compromiso. Si te gusta lo cítrico, la de limón tiene ese punto ácido-dulce que se queda en el paladar. Y si vas más de chocolate, el Volcán no decepciona.',
    recommended_product: 'VOLCÁN DE CHOCOLATE',
    priority: 'high',
    products: 'PORCIONES TARTAS x2',
  },
  {
    id: '61e10184-c698-43b0-8a38-f1cd587179ca',
    title: 'Anna, sobre las donas',
    customer_name: 'Anna VALDIVIESO',
    customer_email: 'annavaldi@icloud.com',
    copy: 'Anna, la Dona Kinder tiene una crema de avellana que se nota en cada bocado. La Banana lleva plátano real con chocolate. Cuatro donas, cuatro sabores distintos — y todas sin gluten. Si te van los dulces más contundentes, la Cookie XXL de chocolate y avellanas es otro nivel.',
    recommended_product: 'Cookie XXL de Chocolate y Avellanas',
    priority: 'medium',
    products: 'DONA KINDER, DONA PEANUT REESE, DONA BANANA CROC, DONA RAFAELLO',
  },
  {
    id: '4b97b285-1c4f-48d1-8282-c992c7498a93',
    title: 'Lorena, la Tarta Bebé',
    customer_name: 'Lorena Pereira',
    customer_email: 'pereira.lorena@gmail.com',
    copy: 'Lorena, la Tarta Bebé tiene un bizcocho tierno con un toque de vainilla que se deshace. Todo sin gluten y con ingredientes naturales. Si buscas algo para acompañar, las Pastas de Té tienen esa textura fina que va muy bien después.',
    recommended_product: 'PASTAS DE TÉ',
    priority: 'medium',
    products: 'TARTA BEBÉ',
  },
  {
    id: '1fbc09ad-0f37-48c3-a2dc-5e28b14b9ecf',
    title: 'Paola, lo de la Caja Merienda',
    customer_name: 'Paola Serrano',
    customer_email: 'paosealc@gmail.com',
    copy: 'Paola, la Caja Merienda tiene un poco de todo — dulce, esponjoso, crujiente. La Dona Kinder con su crema de avellana es la favorita. Si te gusta el chocolate intenso, prueba el Volcán de Chocolate. Cuando lo cortas, el centro fluye.',
    recommended_product: 'VOLCÁN DE CHOCOLATE',
    priority: 'medium',
    products: 'CAJA MERIENDA (9 unidades), DONA KINDER',
  },
  {
    id: 'aad6ce41-33a6-48d1-836d-333c4b086e2b',
    title: 'Sergio, el Volcán de Chocolate',
    customer_name: 'Sergio García',
    customer_email: 'sgarcia@bdibiotech.com',
    copy: 'Sergio, el Volcán de Chocolate tiene un centro que fluye espeso y caliente cuando lo cortas. Chocolate puro, sin gluten, sin prisa. Si te gusta el contraste, la Tarta de Queso tiene un punto ácido que equilibra perfecto después de tanto chocolate.',
    recommended_product: 'TARTA DE QUESO',
    priority: 'medium',
    products: 'VOLCÁN DE CHOCOLATE',
  },
  {
    id: 'dd3677b7-0592-40e8-a436-6854fa69143f',
    title: 'Cecilia, la Tarta de Queso',
    customer_name: 'Cecilia Chamorro',
    customer_email: 'cecilia@fseal.com',
    copy: 'Cecilia, la Tarta de Queso tiene esa textura cremosa y densa que se queda en el paladar. Un toque ácido justo. Si no la conoces todavía, la Tarta de Limón tiene un carácter parecido — cítrica, fresca, con una base crujiente.',
    recommended_product: 'TARTA DE LIMÓN',
    priority: 'medium',
    products: 'TARTA DE QUESO',
  },
  {
    id: 'a398d880-e65e-4502-8784-1ddb1487bf77',
    title: 'Daniela, algo sobre la Tarta de Queso',
    customer_name: 'Daniela Tapia',
    customer_email: 'espartanogameraura@gmail.com',
    copy: 'Daniela, la Tarta de Queso es cremosa, densa, y tiene ese punto ácido que la hace diferente. Todo sin gluten. Para acompañar, la Hogaza de Pasas y Nueces tiene una corteza crujiente con un interior suave que sorprende.',
    recommended_product: 'HOGAZA PASAS Y NUECES',
    priority: 'low',
    products: 'TARTA DE QUESO',
  },
  {
    id: 'c6feb5cc-c43a-4935-a78d-708056f10b4d',
    title: 'Ana, tu selección',
    customer_name: 'Ana Flo',
    customer_email: 'anaflo86@hotmail.com',
    copy: 'Ana, el Pan de Molde Semillas tiene una textura esponjosa llena de semillas que crujen. La Cookie XXL de chocolate y avellanas es crujiente por fuera y tierna por dentro. Si te va lo dulce, la Tarta de Zanahoria con su toque de canela es otro mundo.',
    recommended_product: 'TARTA DE ZANAHORIA',
    priority: 'low',
    products: 'PAN DE MOLDE SEMILLAS, CRACKERS NATURAL, BIZCOCHO DE LA CASA, Cookie XXL de Chocolate y Avellanas',
  },
  {
    id: 'c9446f8a-bdbc-4e8c-b97d-e7502bfd9f24',
    title: 'Miriam, lo de la Granola',
    customer_name: 'Miriam Lopez Martin',
    customer_email: 'miriamlopezmartin@icloud.com',
    copy: 'Miriam, la Granola lleva avena dorada con almendras tostadas y un toque de canela. Con yogur por la mañana es otro desayuno. El Bizcocho Marmolado mezcla cacao y vainilla — si te gustan los dos, no tienes que elegir. Y si quieres probar algo nuevo, la Tarta de Limón tiene un ácido-dulce que engancha.',
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
