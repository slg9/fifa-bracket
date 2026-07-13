import type { Team } from '../types'

const ASSUMED_ATTACKER_COUNT = 8
const ASSUMED_KEEPER_COUNT = 3

type RoleSplit = {
  attackers: string[]
  defenders: string[]
  keepers: string[]
}

const ROLE_PRIORITY: Record<string, Partial<Record<keyof RoleSplit, string[]>>> = {
  MEX: {
    attackers: ['Hirving Lozano', 'Santiago Gimenez', 'Raúl Jiménez', 'Alexis Vega', 'Uriel Antuna', 'Henry Martín', 'Roberto Alvarado', 'Rogelio Funes Mori'],
    defenders: ['Edson Álvarez', 'César Montes', 'Johan Vásquez', 'Jesús Gallardo', 'Jorge Sánchez', 'Néstor Araujo'],
    keepers: ['Guillermo Ochoa', 'Carlos Acevedo', 'Julio González'],
  },
  RSA: {
    attackers: ['Percy Tau', 'Lyle Foster', 'Themba Zwane', 'Relebohile Mofokeng', 'Evidence Makgopa', 'Sipho Mbule'],
    defenders: ['Khuliso Mudau', 'Teboho Mokoena', 'Mothobi Mvala', 'Nkosinathi Sibisi', 'Rushine De Reuck', 'Terrence Mashego'],
    keepers: ['Ronwen Williams', 'Veli Mothwa', 'Bruce Bvuma'],
  },
  KOR: {
    attackers: ['Son Heung-min', 'Lee Kang-in', 'Hwang Hee-chan', 'Cho Gue-sung', 'Oh Hyeon-gyu', 'Jeong Sang-bin'],
    defenders: ['Kim Min-jae', 'Kim Jin-su', 'Kim Young-gwon', 'Jung Woo-young', 'Lee Jae-sung', 'Hwang In-beom'],
    keepers: ['Kim Seung-gyu', 'Cho Hyun-woo', 'Song Bum-keun'],
  },
  CZE: {
    attackers: ['Patrik Schick', 'Adam Hložek', 'Tomáš Čvančara', 'Jan Kuchta', 'Václav Jurečka', 'Mojmír Chytil'],
    defenders: ['Tomáš Souček', 'Vladimír Coufal', 'Ladislav Krejčí', 'Pavel Kadeřábek', 'David Jurásek', 'Tomáš Holeš'],
    keepers: ['Jiří Staněk', 'Matěj Kovář', 'Tomáš Koubek'],
  },
  CAN: {
    attackers: ['Jonathan David', 'Alphonso Davies', 'Cyle Larin', 'Tajon Buchanan', 'Theo Corbeanu', 'Lucas Cavallini'],
    defenders: ['Stephen Eustáquio', 'Ismael Koné', 'Alistair Johnston', 'Kamal Miller', 'Richie Laryea', 'Derek Cornelius'],
    keepers: ['Maxime Crépeau', 'Milan Borjan', 'James Pantemis'],
  },
  BIH: {
    attackers: ['Edin Džeko', 'Ermedin Demirović', 'Miralem Pjanić', 'Armin Hodžić', 'Kenan Kodro', 'Edin Višća'],
    defenders: ['Sead Kolašinac', 'Anel Ahmedhodžić', 'Amar Dedić', 'Denis Huseinbašić', 'Haris Hajradinović'],
    keepers: ['Ibrahim Šehić', 'Nikola Vasilj', 'Jasmin Fejzić'],
  },
  QAT: {
    attackers: ['Akram Afif', 'Almoez Ali', 'Hassan Al-Haydos', 'Omar Al-Somah', 'Mohammed Muntari', 'Yusuf Abdurisag'],
    defenders: ['Pedro Miguel', 'Boualem Khoukhi', 'Abdelkarim Hassan', 'Bassam Al-Rawi', 'Homam Ahmed', 'Tarek Salman'],
    keepers: ['Meshaal Barsham', 'Yousef Hassan', 'Mohammed Al-Bakri'],
  },
  SUI: {
    attackers: ['Breel Embolo', 'Noah Okafor', 'Zeki Amdouni', 'Dan Ndoye', 'Kwadwo Duah', 'Haris Seferovic'],
    defenders: ['Manuel Akanji', 'Granit Xhaka', 'Nico Elvedi', 'Fabian Schär', 'Ricardo Rodríguez', 'Denis Zakaria'],
    keepers: ['Gregor Kobel', 'Yann Sommer', 'Jonas Omlin'],
  },
  BRA: {
    attackers: ['Vinicius Jr', 'Rodrygo', 'Raphinha', 'Endrick', 'Gabriel Martinelli', 'Gabriel Jesus', 'Matheus Cunha', 'Pedro'],
    defenders: ['Marquinhos', 'Éder Militão', 'Gabriel Magalhães', 'Casemiro', 'Bruno Guimarães', 'Danilo'],
    keepers: ['Alisson Becker', 'Ederson', 'Weverton'],
  },
  MAR: {
    attackers: ['Achraf Hakimi', 'Youssef En-Nesyri', 'Soufiane Rahimi', 'Amine Harit', 'Abderrazak Hamdallah', 'Ayoub El Kaabi'],
    defenders: ['Achraf Hakimi', 'Noussair Mazraoui', 'Sofyan Amrabat', 'Nayef Aguerd', 'Romain Saïss', 'Azzedine Ounahi'],
    keepers: ['Yassine Bounou', 'Munir Mohamedi', 'Ahmed Reda Tagnaouti'],
  },
  HAI: {
    attackers: ['Duckens Nazon', 'Frantzdy Pierrot', 'Derrick Etienne', 'Carnejy Antoine', 'Mickael Cantave', 'Jodel Dossou'],
    defenders: ['Wilde-Donald Guerrier', 'Romain Genevois', 'Mechack Jérôme', 'Kevin Lafrance', 'Steeven Saba'],
    keepers: ['Josue Duverger'],
  },
  SCO: {
    attackers: ['Scott McTominay', 'John McGinn', 'Ben Doak', 'Che Adams', 'Ryan Gauld', 'Lawrence Shankland'],
    defenders: ['Andy Robertson', 'Kieran Tierney', 'Scott McKenna', 'Grant Hanley', 'Ryan Porteous', 'Billy Gilmour'],
    keepers: ['Angus Gunn', 'Craig Gordon', 'Liam Kelly'],
  },
  USA: {
    attackers: ['Christian Pulisic', 'Folarin Balogun', 'Gio Reyna', 'Ricardo Pepi', 'Josh Sargent', 'Brendan Aaronson'],
    defenders: ['Antonee Robinson', 'Tyler Adams', 'Weston McKennie', 'Sergiño Dest', 'Tim Ream', 'Walker Zimmerman'],
    keepers: ['Matt Turner', 'Zack Steffen', 'Patrick Schulte'],
  },
  PAR: {
    attackers: ['Miguel Almirón', 'Julio Enciso', 'Antonio Sanabria', 'Ramón Sosa', 'Alejandro Romero Gamarra', 'Carlos González'],
    defenders: ['Gustavo Gómez', 'Omar Alderete', 'Junior Alonso', 'Fabián Balbuena', 'Andrés Cubas', 'Robert Rojas'],
    keepers: ['Gatito Fernández', 'Antony Silva', 'Rodrigo Muñoz'],
  },
  AUS: {
    attackers: ['Craig Goodwin', 'Mitchell Duke', 'Martin Boyle', 'Riley McGree', 'Garang Kuol', 'Jamie Maclaren'],
    defenders: ['Harry Souttar', 'Jackson Irvine', 'Kye Rowles', 'Miloš Degenek', 'Aaron Mooy', 'Fran Karačić'],
    keepers: ['Mat Ryan', 'Joe Gauci', 'Danny Vukovic'],
  },
  TUR: {
    attackers: ['Arda Güler', 'Hakan Çalhanoğlu', 'Kerem Aktürkoğlu', 'Barış Alper Yılmaz', 'Cenk Tosun', 'Yusuf Yazıcı'],
    defenders: ['Hakan Çalhanoğlu', 'Merih Demiral', 'Ferdi Kadıoğlu', 'Çağlar Söyüncü', 'Zeki Çelik', 'Kaan Ayhan'],
    keepers: ['Uğurcan Çakır', 'Mert Günok', 'Altay Bayındır'],
  },
  GER: {
    attackers: ['Jamal Musiala', 'Florian Wirtz', 'Kai Havertz', 'Leroy Sané', 'Serge Gnabry', 'Thomas Müller', 'Niclas Füllkrug'],
    defenders: ['Antonio Rüdiger', 'Jonathan Tah', 'Nico Schlotterbeck', 'Joshua Kimmich', 'Leon Goretzka', 'David Raum'],
    keepers: ['Manuel Neuer', 'Marc-André ter Stegen', 'Oliver Baumann'],
  },
  CIV: {
    attackers: ['Sébastien Haller', 'Wilfried Zaha', 'Amad Diallo', 'Nicolas Pépé', 'Max Gradel', 'Lacina Traoré'],
    defenders: ['Franck Kessié', 'Serge Aurier', 'Wilfried Singo', 'Odilon Kossounou', 'Eric Bailly', 'Ghislain Konan'],
    keepers: ['Yahia Fofana'],
  },
  ECU: {
    attackers: ['Enner Valencia', 'Moisés Caicedo', 'Gonzalo Plata', 'Jeremy Sarmiento', 'Kevin Rodríguez', 'Michael Estrada'],
    defenders: ['Piero Hincapié', 'Pervis Estupiñán', 'Moisés Caicedo', 'Félix Torres', 'Ángelo Preciado', 'Robert Arboleda'],
    keepers: ['Hernán Galíndez', 'Alexander Domínguez', 'Moisés Ramírez'],
  },
  CUW: {
    attackers: ['Leandro Bacuna', 'Jetro Willems', 'Brandley Kuwas', 'Rangelo Janga', 'Darryl Lachman', 'Quentin Thurman'],
    defenders: ['Cuco Martina', 'Juriën Timber', 'Leandro Bacuna', 'Jetro Willems', 'Dion Malone', 'Radinio Balker'],
    keepers: ['Eloy Room'],
  },
  NED: {
    attackers: ['Cody Gakpo', 'Memphis Depay', 'Xavi Simons', 'Donyell Malen', 'Steven Berghuis', 'Wout Weghorst'],
    defenders: ['Virgil van Dijk', 'Frenkie de Jong', 'Matthijs de Ligt', 'Denzel Dumfries', 'Nathan Aké', 'Stefan de Vrij'],
    keepers: ['Jasper Cillessen', 'Mark Flekken', 'Remko Pasveer'],
  },
  JPN: {
    attackers: ['Kaoru Mitoma', 'Takefusa Kubo', 'Ritsu Doan', 'Junya Ito', 'Daichi Kamada', 'Ayase Ueda', 'Kyogo Furuhashi'],
    defenders: ['Takehiro Tomiyasu', 'Wataru Endō', 'Ko Itakura', 'Yuto Nagatomo', 'Hiroki Sakai', 'Hidemasa Morita'],
    keepers: ['Zion Suzuki', 'Shuichi Gonda', 'Keisuke Osako'],
  },
  SWE: {
    attackers: ['Alexander Isak', 'Dejan Kulusevski', 'Zlatan Ibrahimović', 'Emil Forsberg', 'Viktor Claesson', 'Robin Quaison'],
    defenders: ['Victor Nilsson Lindelöf', 'Ludwig Augustinsson', 'Emil Krafth', 'Carl Starfelt', 'Filip Helander'],
    keepers: ['Robin Olsen', 'Kristoffer Nordfeldt', 'Karl-Johan Johnsson'],
  },
  BEL: {
    attackers: ['Kevin De Bruyne', 'Romelu Lukaku', 'Jeremy Doku', 'Leandro Trossard', 'Lois Openda', 'Johan Bakayoko'],
    defenders: ['Kevin De Bruyne', 'Amadou Onana', 'Arthur Theate', 'Wout Faes', 'Timothy Castagne', 'Youri Tielemans'],
    keepers: ['Thibaut Courtois', 'Simon Mignolet', 'Thomas Kaminski'],
  },
  TUN: {
    attackers: ['Wahbi Khazri', 'Hannibal Mejbri', 'Naim Sliti', 'Seifeddine Jaziri', 'Anis Ben Slimane', 'Issam Jebali'],
    defenders: ['Ellyes Skhiri', 'Ali Maâloul', 'Montassar Talbi', 'Yassine Meriah', 'Dylan Bronn', 'Mohamed Drager'],
    keepers: ['Aymen Dahmen', 'Bechir Ben Said', 'Mouez Hassen'],
  },
  EGY: {
    attackers: ['Mohamed Salah', 'Omar Marmoush', 'Mostafa Mohamed', 'Mahmoud Trezeguet', 'Ahmed Sayed Zizo', 'Ibrahim Adel', 'Haissem Hassan', 'Osama Faisal'],
    defenders: ['Ahmed Hegazy', 'Mohamed Abdelmonem', 'Ramy Rabia', 'Mohamed Hany', 'Omar Kamal', 'Ahmed Fatouh', 'Mohamed Hamdy'],
    keepers: ['Mohamed El-Shenawy', 'Mostafa Shobeir', 'Mohamed Sobhi'],
  },
  IRN: {
    attackers: ['Mehdi Taremi', 'Sardar Azmoun', 'Alireza Jahanbakhsh', 'Saman Ghoddos', 'Ali Gholizadeh', 'Karim Ansarifard'],
    defenders: ['Saeid Ezatolahi', 'Ehsan Hajsafi', 'Hossein Kanaanizadegan', 'Majid Hosseini', 'Ramin Rezaeian'],
    keepers: ['Alireza Beiranvand', 'Hossein Hosseini', 'Amir Abedzadeh'],
  },
  NZL: {
    attackers: ['Chris Wood', 'Sarpreet Singh', 'Matthew Garbett', 'Elijah Just', 'Callum McCowatt', 'Ryan Thomas'],
    defenders: ['Winston Reid', 'Liberato Cacace', 'Tommy Smith', 'Michael Boxall', 'Nando Pijnaker', 'Joe Bell'],
    keepers: ['Oliver Sail', 'Stefan Marinovic', 'Michael Woud'],
  },
  URU: {
    attackers: ['Darwin Núñez', 'Federico Valverde', 'Facundo Pellistri', 'Rodrigo Bentancur', 'Giorgian de Arrascaeta', 'Brian Rodríguez'],
    defenders: ['Ronald Araújo', 'José María Giménez', 'Federico Valverde', 'Manuel Ugarte', 'Mathías Olivera', 'Sebastián Cáceres'],
    keepers: ['Sergio Rochet', 'Fernando Muslera', 'Santiago Mele'],
  },
  ESP: {
    attackers: ['Lamine Yamal', 'Nico Williams', 'Pedri', 'Dani Olmo', 'Ferran Torres', 'Mikel Oyarzabal', 'Gavi'],
    defenders: ['Rodri', 'Pau Cubarsí', 'Aymeric Laporte', 'Marc Cucurella', 'Pedro Porro', 'Álex Grimaldo'],
    keepers: ['Unai Simón', 'David Raya', 'Joan Garcia'],
  },
  CPV: {
    attackers: ['Ryan Mendes', 'Jovane Cabral', 'Garry Rodrigues', 'Hélio Varela', 'Dailon Livramento', 'Nuno da Costa'],
    defenders: ['Logan Costa', 'Steven Moreira', 'Jamiro Monteiro', 'Pico Lopes', 'Stopira', 'Kevin Pina'],
    keepers: ['Vozinha', 'Mácrio Rosa', 'CJ dos Santos'],
  },
  KSA: {
    attackers: ['Salem Al-Dawsari', 'Firas Al-Buraikan', 'Saleh Al-Shehri', 'Ayman Yahya', 'Mohamed Kanno', 'Abdullah Al-Hamdan'],
    defenders: ['Saud Abdulhamid', 'Hassan Al-Tambakti', 'Ali Lajami', 'Abdulelah Al-Amri', 'Hassan Kadesh', 'Moteb Al-Harbi'],
    keepers: ['Mohammed Al-Owais', 'Nawaf Al-Aqidi', 'Ahmed Al-Kassar'],
  },
  FRA: {
    attackers: ['Kylian Mbappé', 'Ousmane Dembélé', 'Michael Olise', 'Marcus Thuram', 'Bradley Barcola', 'Rayan Cherki', 'Désiré Doué', 'Maghnes Akliouche', 'Jean-Philippe Mateta'],
    defenders: ['Dayot Upamecano', 'William Saliba', 'Jules Koundé', 'Ibrahima Konate', 'Théo Hernandez', 'Lucas Hernandez', 'Aurélien Tchouaméni', 'N\'Golo Kanté'],
    keepers: ['Mike Maignan', 'Brice Samba', 'Robin Risser'],
  },
  SEN: {
    attackers: ['Sadio Mané', 'Nicolas Jackson', 'Ismaïla Sarr', 'Iliman Ndiaye', 'Bamba Dieng', 'Cherif Ndiaye'],
    defenders: ['Kalidou Koulibaly', 'Édouard Mendy', 'Pape Matar Sarr', 'Idrissa Gueye', 'Ismail Jakobs', 'Moussa Niakhatté'],
    keepers: ['Édouard Mendy', 'Yehvann Diouf', 'Mory Diaw'],
  },
  IRQ: {
    attackers: ['Aymen Hussein', 'Ali Jasim', 'Ali Al-Hamadi', 'Ibrahim Bayesh', 'Zidane Iqbal', 'Ahmed Qasem'],
    defenders: ['Zidane Iqbal', 'Frans Putros', 'Rebin Sulaka', 'Hussein Ali', 'Merchas Doski', 'Mustafa Saadoon'],
    keepers: ['Jalal Hassan', 'Fahad Talib', 'Ahmed Basil'],
  },
  NOR: {
    attackers: ['Erling Haaland', 'Martin Ødegaard', 'Alexander Sørloth', 'Oscar Bobb', 'Antonio Nusa', 'Jørgen Strand Larsen'],
    defenders: ['Martin Ødegaard', 'Kristoffer Ajer', 'Leo Østigård', 'Julian Ryerson', 'Patrick Berg', 'Sander Berge'],
    keepers: ['Ørjan Nyland', 'Egil Selvik', 'Sander Tangvik'],
  },
  ARG: {
    attackers: ['Lionel Messi', 'Lautaro Martínez', 'Julián Álvarez', 'Paulo Dybala', 'Ángel Di María', 'Thiago Almada', 'Nico Paz'],
    defenders: ['Cristian Romero', 'Lisandro Martínez', 'Enzo Fernández', 'Rodrigo De Paul', 'Alexis Mac Allister', 'Nicolás Otamendi'],
    keepers: ['Emiliano Martínez', 'Gerónimo Rulli', 'Juan Musso'],
  },
  ALG: {
    attackers: ['Riyad Mahrez', 'Mohamed Amoura', 'Anis Hadj Moussa', 'Farès Ghedjemis', 'Adil Boulbina', 'Nadhir Benbouali'],
    defenders: ['Aïssa Mandi', 'Rayan Aït-Nouri', 'Ismaël Bennacer', 'Houssem Aouar', 'Nabil Bentaleb', 'Youcef Atal'],
    keepers: ['Luca Zidane', 'Oussama Benbot', 'Melvin Mastil'],
  },
  AUT: {
    attackers: ['Marko Arnautović', 'Michael Gregoritsch', 'Patrick Wimmer', 'Saša Kalajdžić', 'Alessandro Schöpf'],
    defenders: ['David Alaba', 'Konrad Laimer', 'Marcel Sabitzer', 'Kevin Danso', 'Philipp Lienhart', 'David Affengruber'],
    keepers: ['Patrick Pentz', 'Alexander Schlager', 'Florian Wiegele'],
  },
  JOR: {
    attackers: ['Musa Al-Taamari', 'Ali Olwan', 'Mahmoud Al-Mardi', 'Odeh Al-Fakhouri', 'Ali Azaizeh'],
    defenders: ['Yazan Al-Arab', 'Ihsan Haddad', 'Nizar Al-Rashdan', 'Mohammad Abu Hashish'],
    keepers: ['Yazeed Abulaila', 'Nour Bani Attiah', 'Abdallah Al-Fakhouri'],
  },
  POR: {
    attackers: ['Cristiano Ronaldo', 'Rafael Leão', 'Bernardo Silva', 'Bruno Fernandes', 'Pedro Neto', 'Francisco Conceição', 'João Félix'],
    defenders: ['Rúben Dias', 'Nuno Mendes', 'João Cancelo', 'Vitinha', 'Bruno Fernandes', 'Nélson Semedo'],
    keepers: ['Diogo Costa', 'José Sá', 'Rui Silva'],
  },
  COD: {
    attackers: ['Yoane Wissa', 'Cédric Bakambu', 'Meschak Elia', 'Simon Banza', 'Fiston Mayele'],
    defenders: ['Aaron Wan-Bissaka', 'Chancel Mbemba', 'Arthur Masuaku', 'Samuel Moutoussamy', 'Timothy Fayulu'],
    keepers: ['Lionel Mpasi', 'Timothy Fayulu', 'Matthieu Epolo'],
  },
  UZB: {
    attackers: ['Eldor Shomurodov', 'Abbosbek Fayzullaev', 'Igor Sergeev', 'Azizbek Amonov', 'Sherzod Esanov'],
    defenders: ['Abdukodir Khusanov', 'Otabek Shukurov', 'Odiljon Hamrobekov', 'Farrukh Sayfiev'],
    keepers: ['Utkir Yusupov', 'Abduvohid Nematov', 'Botirali Ergashev'],
  },
  ENG: {
    attackers: ['Harry Kane', 'Bukayo Saka', 'Jude Bellingham', 'Marcus Rashford', 'Eberechi Eze', 'Ollie Watkins', 'Anthony Gordon'],
    defenders: ['Declan Rice', 'John Stones', 'Marc Guéhi', 'Reece James', 'Ezri Konsa', 'Kobbie Mainoo'],
    keepers: ['Jordan Pickford', 'Dean Henderson', 'James Trafford'],
  },
  CRO: {
    attackers: ['Luka Modrić', 'Ivan Perišić', 'Andrej Kramarić', 'Ante Budimir', 'Luka Sučić', 'Petar Musa'],
    defenders: ['Joško Gvardiol', 'Luka Modrić', 'Mateo Kovačić', 'Josip Šutalo', 'Josip Stanišić', 'Duje Ćaleta-Car'],
    keepers: ['Dominik Livaković', 'Dominik Kotarski', 'Ivor Pandur'],
  },
  COL: {
    attackers: ['Luis Díaz', 'James Rodríguez', 'Jhon Arias', 'Jhon Córdoba', 'Cucho Hernández', 'Juan Fernando Quintero'],
    defenders: ['Daniel Muñoz', 'Jefferson Lerma', 'Dávinson Sánchez', 'Johan Mojica', 'Yerry Mina', 'Juan Portilla'],
    keepers: ['Camilo Vargas', 'David Ospina', 'Álvaro Montero'],
  },
  GHA: {
    attackers: ['Iñaki Williams', 'Mohammed Kudus', 'Jordan Ayew', 'Antoine Semenyo', 'Kamaldeen Sulemana', 'Ernest Nuamah'],
    defenders: ['Thomas Partey', 'Alidu Seidu', 'Gideon Mensah', 'Abdul Rahman Baba', 'Jonas Adjetey', 'Abdul Mumin'],
    keepers: ['Lawrence Ati-Zigi', 'Benjamin Asare', 'Joseph Anang'],
  },
  PAN: {
    attackers: ['José Fajardo', 'Cecilio Waterman', 'Yoel Bárcenas', 'Ismael Díaz', 'José Luis Rodríguez', 'Tomás Rodríguez'],
    defenders: ['Michael Amir Murillo', 'José Córdoba', 'Fidel Escobar', 'Eric Davis', 'César Blackman', 'Aníbal Godoy'],
    keepers: ['Luis Mejía', 'Orlando Mosquera', 'César Samudio'],
  },
}

function normalizePlayerName(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function uniquePlayerNames(players: string[] | undefined) {
  return Array.from(new Set((players ?? []).map((name) => name.trim()).filter(Boolean)))
}

function rankPool(teamId: string | undefined, role: keyof RoleSplit, pool: string[]) {
  const priorities = ROLE_PRIORITY[teamId ?? '']?.[role] ?? []
  if (!priorities.length) return pool
  const rank = new Map(priorities.map((name, index) => [normalizePlayerName(name), index]))
  return [...pool].sort((a, b) => {
    const ra = rank.get(normalizePlayerName(a)) ?? 999
    const rb = rank.get(normalizePlayerName(b)) ?? 999
    return ra - rb
  })
}

export function splitTeamPlayerRoles(team?: Pick<Team, 'id' | 'players' | 'playerRoles'>): RoleSplit {
  const names = uniquePlayerNames(team?.players)
  if (!names.length) return { attackers: [], defenders: [], keepers: [] }

  const roleAttackers = uniquePlayerNames(team?.playerRoles?.attackers)
  const roleMidfielders = uniquePlayerNames(team?.playerRoles?.midfielders)
  const roleDefenders = uniquePlayerNames(team?.playerRoles?.defenders)
  const roleKeepers = uniquePlayerNames(team?.playerRoles?.keepers)
  const hasExplicitRoles = roleAttackers.length || roleMidfielders.length || roleDefenders.length || roleKeepers.length

  if (hasExplicitRoles) {
    const attackers = roleAttackers.length ? roleAttackers : names.slice(-ASSUMED_ATTACKER_COUNT)
    const keepers = roleKeepers.length ? roleKeepers : names.slice(0, ASSUMED_KEEPER_COUNT)
    const defenders = [...roleDefenders, ...roleMidfielders].length
      ? [...roleDefenders, ...roleMidfielders]
      : names.filter((name) => !attackers.includes(name) && !keepers.includes(name))
    return {
      attackers: rankPool(team?.id, 'attackers', attackers),
      defenders: rankPool(team?.id, 'defenders', defenders.length ? defenders : names.filter((name) => !keepers.includes(name))),
      keepers: rankPool(team?.id, 'keepers', keepers),
    }
  }

  if (names.length <= 4) {
    return {
      attackers: rankPool(team?.id, 'attackers', names.slice(0, Math.max(1, names.length - 1))),
      defenders: rankPool(team?.id, 'defenders', names.slice(1, Math.max(1, names.length - 1))),
      keepers: rankPool(team?.id, 'keepers', names.slice(-1)),
    }
  }

  const keeperEnd = Math.min(ASSUMED_KEEPER_COUNT, names.length - 1)
  const attackerStart = Math.max(keeperEnd + 1, names.length - ASSUMED_ATTACKER_COUNT)
  const keepers = names.slice(0, keeperEnd)
  const attackers = names.slice(attackerStart)
  const defenders = names.slice(keeperEnd, attackerStart)
  return {
    attackers: rankPool(team?.id, 'attackers', attackers),
    defenders: rankPool(team?.id, 'defenders', defenders.length ? defenders : names.slice(keeperEnd, Math.max(keeperEnd + 1, names.length - 1))),
    keepers: rankPool(team?.id, 'keepers', keepers.length ? keepers : names.slice(0, 1)),
  }
}
