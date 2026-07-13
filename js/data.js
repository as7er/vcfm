/** 静态数据：俱乐部、名字、阵型 */

/** 通用欧美名池（职员 / 回退） */
export const FIRST_NAMES = [
  "Jack", "Lucas", "Marcus", "Harvey", "Kevin", "Leon", "Noah", "Oscar",
  "Paul", "Ryan", "Sebastian", "Thomas", "Victor", "William", "Alex", "Ben",
  "Carlos", "Daniel", "Ethan", "Felix", "Gabriel", "Henry", "Ivan", "Joe",
  "Kai", "Luis", "Miguel", "Nico", "Oliver", "Pedro", "Quinn", "Rafael",
  "Sammy", "Timo", "Ulrich", "Vincent", "Xavier", "Yuri", "Zach", "Andy",
  "Bruce", "Chris", "David", "Eric", "Frank", "George", "Hans", "Ian",
  "James", "Liam", "Mason", "Nathan", "Owen", "Pablo", "Rico", "Sergio",
];

export const LAST_NAMES = [
  "Smith", "Muller", "Silva", "Rodriguez", "Brown", "Jones", "Garcia", "Martin",
  "Anderson", "Taylor", "Moore", "Jackson", "White", "Harris", "Clark", "Lewis",
  "Walker", "Hall", "Allen", "Young", "Scott", "Green", "Adams", "Baker",
  "Gonzalez", "Navarro", "Costa", "Fernandez", "Diaz", "Lopez", "Perez", "Wilson",
  "Thompson", "Murphy", "Kelly", "Rossi", "Moreau", "Schmidt", "Fischer", "Weber",
  "Wagner", "Becker", "Hoffmann", "Santos", "Oliveira",
];

/**
 * 按国籍的姓名池。
 * order: "family-given" 姓在前（中/韩等足球惯例），"given-family" 名在前。
 * first = 名 / 名罗马字；last = 姓
 */
export const NAMES_BY_NATION = {
  CHN: {
    order: "family-given",
    first: [
      "Wei", "Lei", "Ming", "Jun", "Hao", "Chen", "Yang", "Tao", "Jie", "Peng",
      "Bo", "Kai", "Xin", "Yu", "Feng", "Qiang", "Bin", "Gang", "Long", "Fei",
      "Xiaoming", "Jian", "Yong", "Zhi", "Liang", "Dong", "Cheng", "Xuan", "Rui", "Yi",
      "Haoran", "Yifan", "Zihan", "Yuxuan", "Junhao", "Zixin", "Haoyu", "Yichen",
    ],
    last: [
      "Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou",
      "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "He", "Gao", "Lin", "Luo",
      "Zheng", "Liang", "Xie", "Song", "Tang", "Han", "Feng", "Deng", "Cao", "Peng",
      "Xiao", "Tian", "Dong", "Yuan", "Cai", "Pan", "Lu", "Jiang", "Dai", "Ye",
    ],
  },
  JPN: {
    order: "given-family",
    first: [
      "Hiroto", "Haruto", "Yuto", "Sota", "Ren", "Riku", "Kaito", "Sora", "Hayato", "Yuma",
      "Takumi", "Daiki", "Kenta", "Shota", "Ryo", "Kenji", "Yusuke", "Kazuki", "Naoki", "Tsubasa",
      "Aoi", "Minato", "Itsuki", "Hinata", "Asahi", "Taiga", "Yusei", "Ryota", "Keita", "Shun",
      "Makoto", "Akira", "Satoshi", "Takeshi", "Shinji", "Gaku", "Koji", "Eiji",
    ],
    last: [
      "Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura",
      "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Matsumoto", "Inoue",
      "Kimura", "Hayashi", "Shimizu", "Yamazaki", "Mori", "Abe", "Ikeda", "Hashimoto",
      "Yamashita", "Ishikawa", "Nakajima", "Maeda", "Fujita", "Okada", "Goto", "Hasegawa",
      "Murakami", "Kondo", "Ishii", "Saito", "Sakamoto", "Endo", "Aoki", "Fujii",
    ],
  },
  KOR: {
    order: "family-given",
    first: [
      "Min-jae", "Heung-min", "Jae-sung", "Seung-ho", "Ji-sung", "Young-gwon", "Hyun-soo",
      "Sang-hoon", "Dong-won", "Joon-ho", "Woo-young", "Ki-hun", "Sung-yueng", "Chung-yong",
      "Tae-min", "Jin-hyun", "Kyung-won", "In-beom", "Ui-jo", "Chang-hoon",
      "Min-kyu", "Seung-woo", "Jae-hwan", "Hyun-woo", "Sang-min", "Do-yun", "Ji-hoon",
      "Woo-jin", "Seok-hyun", "Yeon-woo", "Hyeon-jun", "Si-woo", "Jun-seo", "Min-ho",
    ],
    last: [
      "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim",
      "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Yoo", "Hong",
      "Jeon", "Ko", "Moon", "Yang", "Bae", "Baek", "Nam", "Ryu", "Ha", "Noh",
    ],
  },
  ENG: {
    order: "given-family",
    first: [
      "Jack", "Harry", "Oliver", "George", "Noah", "Leo", "Arthur", "Oscar", "Charlie", "Henry",
      "Thomas", "James", "William", "Alfie", "Freddie", "Archie", "Theo", "Jude", "Mason", "Reece",
    ],
    last: [
      "Smith", "Jones", "Taylor", "Brown", "Wilson", "Evans", "Thomas", "Roberts", "Johnson", "Lewis",
      "Walker", "Robinson", "Wood", "Thompson", "White", "Watson", "Jackson", "Wright", "Green", "Hall",
    ],
  },
  ESP: {
    order: "given-family",
    first: [
      "Carlos", "Diego", "Pablo", "Javier", "Sergio", "Alvaro", "Hugo", "Mario", "Ivan", "Adrian",
      "Raul", "Pedro", "Luis", "Miguel", "Andres", "Fernando", "Jorge", "David", "Alex", "Iker",
    ],
    last: [
      "Garcia", "Rodriguez", "Martinez", "Lopez", "Gonzalez", "Hernandez", "Perez", "Sanchez",
      "Ramirez", "Torres", "Flores", "Rivera", "Gomez", "Diaz", "Reyes", "Morales", "Ortiz", "Cruz",
    ],
  },
  GER: {
    order: "given-family",
    first: [
      "Lukas", "Leon", "Felix", "Jonas", "Max", "Tim", "Niklas", "Tobias", "Jan", "Paul",
      "Finn", "Ben", "Elias", "Noah", "Luis", "Julian", "Moritz", "David", "Marco", "Kevin",
    ],
    last: [
      "Muller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
      "Hoffmann", "Schulz", "Koch", "Richter", "Klein", "Wolf", "Schroder", "Neumann", "Schwarz", "Zimmermann",
    ],
  },
  FRA: {
    order: "given-family",
    first: [
      "Lucas", "Hugo", "Louis", "Gabriel", "Arthur", "Jules", "Leo", "Raphael", "Adam", "Nathan",
      "Theo", "Enzo", "Maxime", "Antoine", "Nicolas", "Pierre", "Mathis", "Paul", "Alexandre", "Thomas",
    ],
    last: [
      "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand",
      "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux",
    ],
  },
  ITA: {
    order: "given-family",
    first: [
      "Marco", "Luca", "Andrea", "Matteo", "Alessandro", "Lorenzo", "Francesco", "Davide", "Simone", "Giuseppe",
      "Antonio", "Giovanni", "Riccardo", "Federico", "Nicolo", "Stefano", "Paolo", "Fabio", "Daniele", "Roberto",
    ],
    last: [
      "Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci",
      "Marino", "Greco", "Bruno", "Gallo", "Conti", "De Luca", "Mancini", "Costa", "Giordano", "Rizzo",
    ],
  },
  POR: {
    order: "given-family",
    first: [
      "Joao", "Diogo", "Tiago", "Pedro", "Rui", "Nuno", "Miguel", "Andre", "Bruno", "Ricardo",
      "Goncalo", "Bernardo", "Rafael", "Francisco", "Daniel", "Luis", "Paulo", "Sergio", "Filipe", "Hugo",
    ],
    last: [
      "Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins",
      "Jesus", "Sousa", "Fernandes", "Goncalves", "Gomes", "Lopes", "Marques", "Alves", "Ribeiro", "Pinto",
    ],
  },
  BRA: {
    order: "given-family",
    first: [
      "Lucas", "Gabriel", "Matheus", "Pedro", "Rafael", "Bruno", "Felipe", "Gustavo", "Thiago", "Leonardo",
      "Andre", "Ricardo", "Marcos", "Diego", "Caio", "Vinicius", "Rodrigo", "Eduardo", "Paulo", "Joao",
    ],
    last: [
      "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira",
      "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Rocha", "Almeida", "Nascimento", "Araujo",
    ],
  },
  ARG: {
    order: "given-family",
    first: [
      "Santiago", "Mateo", "Benjamin", "Lucas", "Thiago", "Joaquin", "Lautaro", "Franco", "Tomas", "Nicolas",
      "Diego", "Facundo", "Gonzalo", "Martin", "Emiliano", "Julian", "Agustin", "Ignacio", "Pablo", "Ezequiel",
    ],
    last: [
      "Gonzalez", "Rodriguez", "Fernandez", "Lopez", "Martinez", "Garcia", "Perez", "Sanchez",
      "Romero", "Diaz", "Torres", "Alvarez", "Ruiz", "Ramirez", "Flores", "Acosta", "Benítez", "Castro",
    ],
  },
  NED: {
    order: "given-family",
    first: [
      "Daan", "Sem", "Luuk", "Finn", "Noah", "Levi", "Milan", "Lucas", "Jesse", "Thijs",
      "Bram", "Sven", "Jasper", "Tim", "Max", "Lars", "Ruben", "Stijn", "Koen", "Niek",
    ],
    last: [
      "de Jong", "Jansen", "de Vries", "van den Berg", "van Dijk", "Bakker", "Visser", "Smit",
      "Meijer", "de Boer", "Mulder", "de Groot", "Bos", "Vos", "Peters", "Hendriks", "van Leeuwen", "Dekker",
    ],
  },
  BEL: {
    order: "given-family",
    first: [
      "Lucas", "Louis", "Noah", "Arthur", "Adam", "Liam", "Victor", "Jules", "Nathan", "Mathis",
      "Thomas", "Maxime", "Romain", "Kevin", "Axel", "Dries", "Thibaut", "Youri", "Eden", "Romelu",
    ],
    last: [
      "Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens",
      "Wouters", "De Smet", "Dubois", "Lambert", "Simon", "Martin", "Leroy", "Dupont",
    ],
  },
  CRO: {
    order: "given-family",
    first: [
      "Luka", "Ivan", "Marko", "Josip", "Ante", "Mateo", "Filip", "Domagoj", "Mario", "Nikola",
      "Tin", "Borna", "Andrej", "Dario", "Bruno", "Karlo", "Petar", "Stipe", "Toni", "Vedran",
    ],
    last: [
      "Horvat", "Kovacic", "Babic", "Maric", "Juric", "Novak", "Kovac", "Vukovic",
      "Petrovic", "Tomic", "Peric", "Simic", "Pavic", "Rukavina", "Brozovic", "Modric",
    ],
  },
  URU: {
    order: "given-family",
    first: [
      "Diego", "Luis", "Federico", "Matias", "Nicolas", "Sebastian", "Maximiliano", "Gaston", "Rodrigo", "Lucas",
      "Cristian", "Martin", "Pablo", "Facundo", "Santiago", "Agustin", "Bruno", "Jose", "Carlos", "Edinson",
    ],
    last: [
      "Rodriguez", "Gonzalez", "Fernandez", "Perez", "Martinez", "Silva", "Suarez", "Lopez",
      "Garcia", "Cavani", "Gimenez", "Pereira", "Alvarez", "Nunez", "Bentancur", "Valverde",
    ],
  },
  COL: {
    order: "given-family",
    first: [
      "Juan", "Carlos", "Andres", "Luis", "James", "Radamel", "Yerry", "Davinson", "Mateus", "Luis",
      "Sebastian", "Santiago", "Camilo", "Daniel", "Felipe", "Miguel", "Oscar", "Jhon", "Wilmar", "Jefferson",
    ],
    last: [
      "Rodriguez", "Garcia", "Martinez", "Lopez", "Gonzalez", "Hernandez", "Perez", "Sanchez",
      "Ramirez", "Torres", "Diaz", "Moreno", "Jimenez", "Ruiz", "Vargas", "Castro", "Rojas", "Gomez",
    ],
  },
  MEX: {
    order: "given-family",
    first: [
      "Diego", "Santiago", "Mateo", "Sebastian", "Leonardo", "Emiliano", "Daniel", "Miguel", "Carlos", "Luis",
      "Javier", "Andres", "Raul", "Hector", "Guillermo", "Hirving", "Edson", "Cesar", "Jesus", "Uriel",
    ],
    last: [
      "Hernandez", "Garcia", "Martinez", "Lopez", "Gonzalez", "Perez", "Rodriguez", "Sanchez",
      "Ramirez", "Cruz", "Flores", "Gomez", "Diaz", "Reyes", "Morales", "Torres", "Ortiz", "Gutierrez",
    ],
  },
  USA: {
    order: "given-family",
    first: [
      "Liam", "Noah", "Ethan", "Mason", "Logan", "Lucas", "Aiden", "Jackson", "Sebastian", "Owen",
      "Christian", "Tyler", "Jordan", "Brandon", "Austin", "Dylan", "Hunter", "Caleb", "Nathan", "Miles",
    ],
    last: [
      "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson",
      "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris",
    ],
  },
  NGA: {
    order: "given-family",
    first: [
      "Chinedu", "Emeka", "Ifeanyi", "Obinna", "Chukwudi", "Kelechi", "Victor", "Samuel", "Daniel", "John",
      "Ahmed", "Ibrahim", "Yusuf", "Oluwaseun", "Tunde", "Ade", "Femi", "Bayo", "Chisom", "Nnamdi",
    ],
    last: [
      "Okafor", "Okeke", "Nwosu", "Eze", "Okonkwo", "Ibrahim", "Musa", "Bello",
      "Ogunleye", "Adeyemi", "Balogun", "Adebayo", "Chukwu", "Nwachukwu", "Onyeka", "Igwe", "Uche", "Obi",
    ],
  },
  SEN: {
    order: "given-family",
    first: [
      "Ibrahima", "Moussa", "Cheikh", "Mamadou", "Ousmane", "Sadio", "Kalidou", "Ismaila", "Pape", "Abdou",
      "Boulaye", "Edouard", "Idrissa", "Keita", "Famara", "Habib", "Bamba", "Amadou", "Serigne", "Youssou",
    ],
    last: [
      "Diop", "Ndiaye", "Sarr", "Fall", "Gueye", "Ba", "Diallo", "Sow",
      "Cisse", "Sy", "Mbaye", "Kane", "Thiam", "Faye", "Seck", "Diouf", "Sene", "Camara",
    ],
  },
  GHA: {
    order: "given-family",
    first: [
      "Kwame", "Kofi", "Kwesi", "Yaw", "Kojo", "Ama", "Samuel", "Thomas", "Jordan", "Andre",
      "Mohammed", "Ibrahim", "Daniel", "Joseph", "Emmanuel", "Michael", "Felix", "Richmond", "Benjamin", "Christian",
    ],
    last: [
      "Mensah", "Owusu", "Boateng", "Asante", "Appiah", "Osei", "Agyemang", "Adjei",
      "Yeboah", "Amoah", "Darko", "Frimpong", "Kuffour", "Ofori", "Addo", "Ansah", "Bonsu", "Sarpong",
    ],
  },
  CIV: {
    order: "given-family",
    first: [
      "Serge", "Wilfried", "Nicolas", "Eric", "Max", "Franck", "Jean", "Didier", "Yaya", "Kolo",
      "Salomon", "Gervinho", "Seydou", "Bakary", "Abdul", "Ibrahim", "Oumar", "Cheick", "Ismael", "Sekou",
    ],
    last: [
      "Kone", "Traore", "Coulibaly", "Diallo", "Camara", "Sangare", "Bamba", "Toure",
      "Drogba", "Kalou", "Gervais", "Zaha", "Aurier", "Bailly", "Kessie", "Pepe", "Haller", "Boli",
    ],
  },
  MAR: {
    order: "given-family",
    first: [
      "Youssef", "Amine", "Mehdi", "Hakim", "Sofiane", "Achraf", "Noussair", "Romain", "Azzedine", "Zakaria",
      "Ilias", "Anass", "Bilal", "Hamza", "Ismail", "Karim", "Nabil", "Oussama", "Reda", "Tarik",
    ],
    last: [
      "Amrabat", "Ziyech", "Hakimi", "Mazraoui", "Bounou", "En-Nesyri", "Saiss", "Aguerd",
      "Boufal", "El Khannouss", "Tissoudali", "Benoun", "Munir", "Dari", "Attiat-Allah", "Cheddira",
    ],
  },
  POL: {
    order: "given-family",
    first: [
      "Piotr", "Krzysztof", "Andrzej", "Tomasz", "Jan", "Pawel", "Michal", "Marcin", "Jakub", "Adam",
      "Kamil", "Robert", "Lukasz", "Wojciech", "Grzegorz", "Mateusz", "Bartosz", "Dawid", "Sebastian", "Rafal",
    ],
    last: [
      "Nowak", "Kowalski", "Wisniewski", "Wojcik", "Kowalczyk", "Kaminski", "Lewandowski", "Zielinski",
      "Szymanski", "Wozniak", "Kozlowski", "Jankowski", "Mazur", "Kwiatkowski", "Krawczyk", "Piotrowski",
    ],
  },
  DEN: {
    order: "given-family",
    first: [
      "Lucas", "William", "Noah", "Oscar", "Victor", "Oliver", "Elias", "Carl", "Emil", "Frederik",
      "Mikkel", "Christian", "Andreas", "Jonas", "Mathias", "Thomas", "Nikolaj", "Rasmus", "Simon", "Kasper",
    ],
    last: [
      "Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sorensen",
      "Rasmussen", "Jorgensen", "Petersen", "Madsen", "Kristensen", "Olsen", "Thomsen", "Christiansen",
    ],
  },
  SWE: {
    order: "given-family",
    first: [
      "Erik", "Lars", "Karl", "Anders", "Johan", "Per", "Nils", "Olof", "Gustav", "Mikael",
      "Alexander", "Victor", "Emil", "Oscar", "William", "Lucas", "Hugo", "Elias", "Isak", "Felix",
    ],
    last: [
      "Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson",
      "Svensson", "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson", "Lindberg",
    ],
  },
  NOR: {
    order: "given-family",
    first: [
      "Ole", "Lars", "Erik", "Johan", "Anders", "Nils", "Per", "Thomas", "Martin", "Andreas",
      "Kristian", "Henrik", "Sondre", "Mathias", "Jonas", "Emil", "Oskar", "Elias", "Isak", "Magnus",
    ],
    last: [
      "Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Pedersen", "Nilsen", "Kristiansen",
      "Jensen", "Karlsen", "Berg", "Haugen", "Hagen", "Johannessen", "Andreassen", "Jacobsen",
    ],
  },
  SUI: {
    order: "given-family",
    first: [
      "Noah", "Liam", "Leon", "Luca", "Elias", "Julian", "David", "Nico", "Fabio", "Marco",
      "Kevin", "Stefan", "Michael", "Thomas", "Andreas", "Manuel", "Daniel", "Simon", "Reto", "Xherdan",
    ],
    last: [
      "Muller", "Schmid", "Keller", "Weber", "Huber", "Meier", "Steiner", "Brunner",
      "Fischer", "Baumann", "Frei", "Widmer", "Zuber", "Embolo", "Xhaka", "Shaqiri",
    ],
  },
  AUT: {
    order: "given-family",
    first: [
      "Lukas", "Tobias", "David", "Michael", "Thomas", "Andreas", "Stefan", "Markus", "Florian", "Marcel",
      "Christoph", "Matthias", "Alexander", "Patrick", "Daniel", "Martin", "Philipp", "Julian", "Kevin", "Marco",
    ],
    last: [
      "Gruber", "Huber", "Bauer", "Wagner", "Muller", "Steiner", "Moser", "Mayer",
      "Hofer", "Leitner", "Berger", "Fuchs", "Eder", "Schmid", "Winkler", "Weber",
    ],
  },
  TUR: {
    order: "given-family",
    first: [
      "Mehmet", "Mustafa", "Ahmet", "Ali", "Huseyin", "Hasan", "Ibrahim", "Ismail", "Yusuf", "Omer",
      "Emre", "Burak", "Cenk", "Hakan", "Arda", "Kerem", "Yusuf", "Ozan", "Merih", "Caglar",
    ],
    last: [
      "Yilmaz", "Kaya", "Demir", "Sahin", "Celik", "Yildiz", "Yildirim", "Ozturk",
      "Aydin", "Ozdemir", "Arslan", "Dogan", "Kilic", "Aslan", "Cetin", "Kara", "Koc", "Polat",
    ],
  },
  SRB: {
    order: "given-family",
    first: [
      "Nikola", "Marko", "Stefan", "Luka", "Nemanja", "Dusan", "Aleksandar", "Milos", "Filip", "Jovan",
      "Petar", "Ivan", "Djordje", "Vuk", "Lazar", "Andrej", "Sasa", "Darko", "Igor", "Milan",
    ],
    last: [
      "Jovanovic", "Petrovic", "Nikolic", "Markovic", "Djordjevic", "Stojanovic", "Ilic", "Stankovic",
      "Pavlovic", "Milosevic", "Ristic", "Todorovic", "Popovic", "Kostic", "Mitrovic", "Tadic",
    ],
  },
  UKR: {
    order: "given-family",
    first: [
      "Andriy", "Oleksandr", "Serhiy", "Mykola", "Dmytro", "Vitaliy", "Roman", "Yuriy", "Igor", "Taras",
      "Oleh", "Bohdan", "Artem", "Maksym", "Vladyslav", "Denys", "Ruslan", "Pavlo", "Mykhailo", "Yehor",
    ],
    last: [
      "Shevchenko", "Kovalenko", "Bondarenko", "Tkachenko", "Kravchenko", "Oliynyk", "Shevchuk", "Polishchuk",
      "Boyko", "Kovalchuk", "Melnyk", "Tkachuk", "Moroz", "Rudenko", "Savchenko", "Yarmolenko", "Zinchenko", "Mudryk",
    ],
  },
  SCO: {
    order: "given-family",
    first: [
      "Jack", "James", "Lewis", "Ryan", "Callum", "Scott", "Andrew", "David", "John", "Robert",
      "Craig", "Stuart", "Gordon", "Fraser", "Cameron", "Ross", "Kieran", "Liam", "Connor", "Aidan",
    ],
    last: [
      "Smith", "Brown", "Wilson", "Robertson", "Campbell", "Stewart", "Thomson", "Anderson",
      "Scott", "Murray", "MacDonald", "Reid", "Taylor", "Clark", "Mitchell", "Ross", "Young", "Watson",
    ],
  },
  WAL: {
    order: "given-family",
    first: [
      "Owen", "Rhys", "Dylan", "Gareth", "Ioan", "Tomos", "Dafydd", "Cai", "Osian", "Jac",
      "Aaron", "Ethan", "Harry", "James", "Daniel", "Joseph", "William", "Thomas", "Ben", "Sam",
    ],
    last: [
      "Jones", "Williams", "Davies", "Evans", "Thomas", "Roberts", "Lewis", "Hughes",
      "Morgan", "Griffiths", "Edwards", "Owen", "James", "Morris", "Price", "Rees", "Phillips", "Jenkins",
    ],
  },
  IRL: {
    order: "given-family",
    first: [
      "Jack", "James", "Conor", "Sean", "Adam", "Michael", "Daniel", "Patrick", "Cian", "Oisin",
      "Liam", "Noah", "Finn", "Cillian", "Tadhg", "Eoin", "Ronan", "Darragh", "Shane", "Niall",
    ],
    last: [
      "Murphy", "Kelly", "O'Sullivan", "Walsh", "Smith", "O'Brien", "Byrne", "Ryan",
      "O'Connor", "O'Neill", "O'Reilly", "Doyle", "McCarthy", "Gallagher", "Doherty", "Kennedy", "Lynch", "Murray",
    ],
  },
  AUS: {
    order: "given-family",
    first: [
      "Jack", "Oliver", "William", "Noah", "Thomas", "James", "Lucas", "Henry", "Ethan", "Liam",
      "Cooper", "Mason", "Charlie", "Harry", "Lachlan", "Mitchell", "Riley", "Jake", "Connor", "Bailey",
    ],
    last: [
      "Smith", "Jones", "Williams", "Brown", "Wilson", "Taylor", "Johnson", "White",
      "Martin", "Anderson", "Thompson", "Nguyen", "Thomas", "Walker", "Harris", "Lee", "Ryan", "King",
    ],
  },
};

/** 根据国籍 code 生成姓名；无专用池时回退通用池 */
export function generatePlayerName(nationCode, pickFn) {
  const pick = pickFn || ((arr) => arr[Math.floor(Math.random() * arr.length)]);
  const pool = NAMES_BY_NATION[nationCode];
  if (!pool) {
    return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  }
  const first = pick(pool.first);
  const last = pick(pool.last);
  return pool.order === "family-given" ? `${last} ${first}` : `${first} ${last}`;
}

/**
 * 球场 / 列表短名：取姓氏。
 * 中/韩等 family-given 取首词；其余取末词。
 */
export function playerDisplaySurname(name, nationCode) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0];
  const pool = NAMES_BY_NATION[nationCode];
  if (pool?.order === "family-given") return parts[0];
  return parts[parts.length - 1];
}

/** 国籍：code 用于标记，name 中文显示，flag 为 emoji */
export const NATIONALITIES = [
  { code: "ENG", name: "英格兰", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "ESP", name: "西班牙", flag: "🇪🇸" },
  { code: "GER", name: "德国", flag: "🇩🇪" },
  { code: "FRA", name: "法国", flag: "🇫🇷" },
  { code: "ITA", name: "意大利", flag: "🇮🇹" },
  { code: "POR", name: "葡萄牙", flag: "🇵🇹" },
  { code: "BRA", name: "巴西", flag: "🇧🇷" },
  { code: "ARG", name: "阿根廷", flag: "🇦🇷" },
  { code: "NED", name: "荷兰", flag: "🇳🇱" },
  { code: "BEL", name: "比利时", flag: "🇧🇪" },
  { code: "CRO", name: "克罗地亚", flag: "🇭🇷" },
  { code: "URU", name: "乌拉圭", flag: "🇺🇾" },
  { code: "COL", name: "哥伦比亚", flag: "🇨🇴" },
  { code: "MEX", name: "墨西哥", flag: "🇲🇽" },
  { code: "USA", name: "美国", flag: "🇺🇸" },
  { code: "JPN", name: "日本", flag: "🇯🇵" },
  { code: "KOR", name: "韩国", flag: "🇰🇷" },
  { code: "CHN", name: "中国", flag: "🇨🇳" },
  { code: "NGA", name: "尼日利亚", flag: "🇳🇬" },
  { code: "SEN", name: "塞内加尔", flag: "🇸🇳" },
  { code: "GHA", name: "加纳", flag: "🇬🇭" },
  { code: "CIV", name: "科特迪瓦", flag: "🇨🇮" },
  { code: "MAR", name: "摩洛哥", flag: "🇲🇦" },
  { code: "POL", name: "波兰", flag: "🇵🇱" },
  { code: "DEN", name: "丹麦", flag: "🇩🇰" },
  { code: "SWE", name: "瑞典", flag: "🇸🇪" },
  { code: "NOR", name: "挪威", flag: "🇳🇴" },
  { code: "SUI", name: "瑞士", flag: "🇨🇭" },
  { code: "AUT", name: "奥地利", flag: "🇦🇹" },
  { code: "TUR", name: "土耳其", flag: "🇹🇷" },
  { code: "SRB", name: "塞尔维亚", flag: "🇷🇸" },
  { code: "UKR", name: "乌克兰", flag: "🇺🇦" },
  { code: "SCO", name: "苏格兰", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { code: "WAL", name: "威尔士", flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿" },
  { code: "IRL", name: "爱尔兰", flag: "🇮🇪" },
  { code: "AUS", name: "澳大利亚", flag: "🇦🇺" },
];

/** 三级联赛：1 最高，3 最低；开局仅可选第 3 级；每级 20 队 */
export const DIVISIONS = {
  1: { id: 1, name: "超级联赛", short: "超联", promote: 0, relegate: 3 },
  2: { id: 2, name: "甲级联赛", short: "甲级", promote: 3, relegate: 3 },
  3: { id: 3, name: "乙级联赛", short: "乙级", promote: 3, relegate: 0 },
};

export const START_DIVISION = 3;

/** 60 队名单见 clubs.js */
export { CLUB_TEMPLATES } from "./clubs.js";

/** 阵型：位置槽位 { pos: GK|DEF|MID|ATT, x: 0-100, y: 0-100 } y=0 己方球门 */
export const FORMATIONS = {
  "4-3-3": {
    name: "4-3-3",
    desc: "均衡边路进攻",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 28, y: 48 }, { pos: "MID", x: 50, y: 52 }, { pos: "MID", x: 72, y: 48 },
      { pos: "ATT", x: 22, y: 22 }, { pos: "ATT", x: 50, y: 18 }, { pos: "ATT", x: 78, y: 22 },
    ],
  },
  "4-4-2": {
    name: "4-4-2",
    desc: "双前锋 · 经典",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 18, y: 48 }, { pos: "MID", x: 40, y: 50 },
      { pos: "MID", x: 60, y: 50 }, { pos: "MID", x: 82, y: 48 },
      { pos: "ATT", x: 38, y: 20 }, { pos: "ATT", x: 62, y: 20 },
    ],
  },
  "3-5-2": {
    name: "3-5-2",
    desc: "中场人数优势",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 28, y: 74 }, { pos: "DEF", x: 50, y: 76 }, { pos: "DEF", x: 72, y: 74 },
      { pos: "MID", x: 15, y: 50 }, { pos: "MID", x: 35, y: 48 }, { pos: "MID", x: 50, y: 55 },
      { pos: "MID", x: 65, y: 48 }, { pos: "MID", x: 85, y: 50 },
      { pos: "ATT", x: 38, y: 20 }, { pos: "ATT", x: 62, y: 20 },
    ],
  },
  "4-2-3-1": {
    name: "4-2-3-1",
    desc: "双后腰 · 前腰串联",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 38, y: 55 }, { pos: "MID", x: 62, y: 55 },
      { pos: "MID", x: 22, y: 35 }, { pos: "MID", x: 50, y: 38 }, { pos: "MID", x: 78, y: 35 },
      { pos: "ATT", x: 50, y: 16 },
    ],
  },
  "5-3-2": {
    name: "5-3-2",
    desc: "五后卫 · 稳固",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 12, y: 68 }, { pos: "DEF", x: 30, y: 74 }, { pos: "DEF", x: 50, y: 76 },
      { pos: "DEF", x: 70, y: 74 }, { pos: "DEF", x: 88, y: 68 },
      { pos: "MID", x: 30, y: 48 }, { pos: "MID", x: 50, y: 50 }, { pos: "MID", x: 70, y: 48 },
      { pos: "ATT", x: 38, y: 20 }, { pos: "ATT", x: 62, y: 20 },
    ],
  },
  "3-4-3": {
    name: "3-4-3",
    desc: "三前锋 · 强攻",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 28, y: 74 }, { pos: "DEF", x: 50, y: 76 }, { pos: "DEF", x: 72, y: 74 },
      { pos: "MID", x: 20, y: 50 }, { pos: "MID", x: 40, y: 52 }, { pos: "MID", x: 60, y: 52 },
      { pos: "MID", x: 80, y: 50 },
      { pos: "ATT", x: 22, y: 20 }, { pos: "ATT", x: 50, y: 16 }, { pos: "ATT", x: 78, y: 20 },
    ],
  },
  "4-1-4-1": {
    name: "4-1-4-1",
    desc: "单后腰 · 中场屏障",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 50, y: 60 },
      { pos: "MID", x: 18, y: 42 }, { pos: "MID", x: 38, y: 45 }, { pos: "MID", x: 62, y: 45 },
      { pos: "MID", x: 82, y: 42 },
      { pos: "ATT", x: 50, y: 16 },
    ],
  },
  "4-5-1": {
    name: "4-5-1",
    desc: "密集中场 · 防反",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 15, y: 48 }, { pos: "MID", x: 32, y: 52 }, { pos: "MID", x: 50, y: 55 },
      { pos: "MID", x: 68, y: 52 }, { pos: "MID", x: 85, y: 48 },
      { pos: "ATT", x: 50, y: 18 },
    ],
  },
};

/** 阵型对攻防/宽度的实战修正（不再只是站位） */
export const FORMATION_MOD = {
  "4-3-3": { atk: 1.04, def: 0.98, width: 1.06, midfield: 1.0 },
  "4-4-2": { atk: 1.03, def: 1.02, width: 1.0, midfield: 0.98 },
  "3-5-2": { atk: 1.02, def: 0.97, width: 0.96, midfield: 1.1 },
  "4-2-3-1": { atk: 1.05, def: 1.03, width: 1.02, midfield: 1.04 },
  "5-3-2": { atk: 0.94, def: 1.12, width: 0.92, midfield: 0.96 },
  "3-4-3": { atk: 1.1, def: 0.92, width: 1.1, midfield: 0.97 },
  "4-1-4-1": { atk: 0.98, def: 1.06, width: 1.0, midfield: 1.06 },
  "4-5-1": { atk: 0.92, def: 1.1, width: 0.95, midfield: 1.08 },
};

export const POS_LABEL = { GK: "门将", DEF: "后卫", MID: "中场", ATT: "前锋" };

/**
 * 风格修正
 * possession → 控球权重；foulRisk → 犯规倾向；fitness → 体能消耗；chance → 威胁频率
 */
export const STYLE_MOD = {
  balanced: {
    atk: 1,
    def: 1,
    possession: 1,
    foulRisk: 1,
    fitness: 1,
    chance: 1,
  },
  attack: {
    atk: 1.14,
    def: 0.88,
    possession: 1.04,
    foulRisk: 1.05,
    fitness: 1.08,
    chance: 1.12,
  },
  defend: {
    atk: 0.86,
    def: 1.16,
    possession: 0.92,
    foulRisk: 1.08,
    fitness: 0.94,
    chance: 0.88,
  },
  possession: {
    atk: 1.04,
    def: 1.04,
    possession: 1.22,
    foulRisk: 0.88,
    fitness: 0.96,
    chance: 0.95,
  },
  counter: {
    atk: 1.1,
    def: 1.06,
    possession: 0.78,
    foulRisk: 0.95,
    fitness: 0.98,
    chance: 1.06,
  },
};

/**
 * 风格克制：行=我方风格，列=对方风格 → 对我方 atk/def 的乘子
 * 例：反击打进攻型有加成；控球被高压压制
 */
export const STYLE_MATCHUP = {
  balanced: {
    balanced: { atk: 1, def: 1 },
    attack: { atk: 0.98, def: 1.02 },
    defend: { atk: 1.02, def: 0.99 },
    possession: { atk: 1, def: 1 },
    counter: { atk: 0.99, def: 1.01 },
  },
  attack: {
    balanced: { atk: 1.02, def: 0.97 },
    attack: { atk: 1.04, def: 0.94 },
    defend: { atk: 0.94, def: 0.96 },
    possession: { atk: 1.05, def: 0.96 },
    counter: { atk: 0.9, def: 0.92 },
  },
  defend: {
    balanced: { atk: 0.98, def: 1.03 },
    attack: { atk: 0.96, def: 1.08 },
    defend: { atk: 0.97, def: 1.04 },
    possession: { atk: 0.95, def: 1.02 },
    counter: { atk: 1.0, def: 1.02 },
  },
  possession: {
    balanced: { atk: 1.01, def: 1.02 },
    attack: { atk: 0.97, def: 0.98 },
    defend: { atk: 1.04, def: 1.03 },
    possession: { atk: 1.02, def: 1.02 },
    counter: { atk: 0.93, def: 0.97 },
  },
  counter: {
    balanced: { atk: 1.03, def: 1.02 },
    attack: { atk: 1.1, def: 1.04 },
    defend: { atk: 0.96, def: 1.0 },
    possession: { atk: 1.08, def: 1.03 },
    counter: { atk: 1.0, def: 1.0 },
  },
};

/** 战术预设（一键套用） */
export const TACTIC_PRESETS = {
  solid: {
    id: "solid",
    style: "defend",
    pressing: 2,
    tempo: 2,
    width: 2,
    defensiveLine: 2,
    formation: "5-3-2",
  },
  high_press: {
    id: "high_press",
    style: "attack",
    pressing: 5,
    tempo: 4,
    width: 4,
    defensiveLine: 5,
    formation: "4-3-3",
  },
  tiki: {
    id: "tiki",
    style: "possession",
    pressing: 3,
    tempo: 2,
    width: 3,
    defensiveLine: 4,
    formation: "4-2-3-1",
  },
  park_counter: {
    id: "park_counter",
    style: "counter",
    pressing: 2,
    tempo: 4,
    width: 3,
    defensiveLine: 1,
    formation: "4-5-1",
  },
  all_out: {
    id: "all_out",
    style: "attack",
    pressing: 4,
    tempo: 5,
    width: 5,
    defensiveLine: 4,
    formation: "3-4-3",
  },
  balanced: {
    id: "balanced",
    style: "balanced",
    pressing: 3,
    tempo: 3,
    width: 3,
    defensiveLine: 3,
    formation: "4-3-3",
  },
};

export function styleMatchupMod(myStyle, oppStyle) {
  const row = STYLE_MATCHUP[myStyle] || STYLE_MATCHUP.balanced;
  return row[oppStyle] || row.balanced || { atk: 1, def: 1 };
}

/** 生成战术摘要文案用的数值标签 */
export function tacticsSliderLabel(key, v, lang = "zh") {
  const n = Math.max(1, Math.min(5, +v || 3));
  const tables = {
    zh: {
      pressing: ["很低", "偏低", "标准", "偏高", "极高"],
      tempo: ["很慢", "偏慢", "标准", "偏快", "极快"],
      width: ["很窄", "偏窄", "标准", "偏宽", "很宽"],
      defensiveLine: ["很深", "偏深", "标准", "偏高", "很高"],
    },
    en: {
      pressing: ["Very low", "Low", "Standard", "High", "Max"],
      tempo: ["Very slow", "Slow", "Standard", "Fast", "Max"],
      width: ["Very narrow", "Narrow", "Standard", "Wide", "Very wide"],
      defensiveLine: ["Very deep", "Deep", "Standard", "High", "Very high"],
    },
  };
  const t = tables[lang === "en" ? "en" : "zh"][key];
  return t ? t[n - 1] : String(n);
}
