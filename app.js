/**
 * Pokédex Web - Lógica de Conexión con PokéAPI, Filtro por Tipo, Diccionario Alfabético,
 * Navegación por Pestañas, Estadísticas Base, Sonidos y Cadena Evolutiva
 * Vanilla JavaScript (ES6+) con async/await y Fetch API
 */

// Selección de elementos del DOM mediante document.getElementById
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const pokedexContainer = document.getElementById('pokedex-container');

// Elementos del Filtro por Tipo y Diccionario Alfabético
const typeChipsRail = document.getElementById('type-chips-rail');
const activeTypeName = document.getElementById('active-type-name');
const alphabetGrid = document.getElementById('alphabet-grid');
const dictionaryStatus = document.getElementById('dictionary-status');
const letterResults = document.getElementById('letter-results');
const activeLetterBadge = document.getElementById('active-letter-badge');
const letterCount = document.getElementById('letter-count');
const letterPokemonList = document.getElementById('letter-pokemon-list');
const closeResultsBtn = document.getElementById('close-results-btn');

// Catálogo de Tipos de Pokémon (con 'Todos' en primer lugar)
const POKEMON_TYPES = [
  { id: 'all', name: 'Todos' },
  { id: 'fire', name: 'Fuego' },
  { id: 'water', name: 'Agua' },
  { id: 'grass', name: 'Planta' },
  { id: 'electric', name: 'Eléctrico' },
  { id: 'normal', name: 'Normal' },
  { id: 'ice', name: 'Hielo' },
  { id: 'fighting', name: 'Lucha' },
  { id: 'poison', name: 'Veneno' },
  { id: 'ground', name: 'Tierra' },
  { id: 'flying', name: 'Volador' },
  { id: 'psychic', name: 'Psíquico' },
  { id: 'bug', name: 'Bicho' },
  { id: 'rock', name: 'Roca' },
  { id: 'ghost', name: 'Fantasma' },
  { id: 'dragon', name: 'Dragón' },
  { id: 'steel', name: 'Acero' },
  { id: 'dark', name: 'Siniestro' },
  { id: 'fairy', name: 'Hada' }
];

// Estructura de almacenamiento en memoria
const alphabetLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/** @type {Record<string, Array<{ name: string, id: number, sprite: string }>>} */
const pokemonDictionary = {};
alphabetLetters.forEach((letter) => {
  pokemonDictionary[letter] = [];
});

/** @type {Array<{ name: string, id: number, sprite: string }>} */
let allPokemonList = [];
/** @type {Record<string, Array<{ name: string, id: number, sprite: string }>>} */
const typePokemonCache = {};

let currentSelectedType = 'all';
let currentActiveLetter = null;

/**
 * Función principal para buscar un Pokémon en la PokéAPI
 */
async function searchPokemon() {
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!query) {
    return;
  }

  if (pokedexContainer) {
    pokedexContainer.innerHTML = `
      <div class="loading-state">
        <div class="pokeball-spinner" aria-hidden="true"></div>
        <p>Buscando en la Pokédex...</p>
      </div>
    `;
  }

  try {
    // Petición GET a la PokéAPI usando fetch nativo
    let response = await fetch(`https://pokeapi.co/api/v2/pokemon/${query}`);
    let speciesData = null;

    if (!response.ok) {
      // Si la búsqueda por nombre directo falló (ej. 'aegislash', 'giratina', 'deoxys', 'shaymin', etc.
      // cuyos nombres base son especies pero en el endpoint de pokemon requieren sufijo de forma),
      // consultamos el endpoint /pokemon-species/ para obtener la variedad predeterminada
      try {
        const speciesRes = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${query}`);
        if (speciesRes.ok) {
          speciesData = await speciesRes.json();
          const defaultVariety = (speciesData.varieties || []).find((v) => v.is_default) || (speciesData.varieties || [])[0];
          if (defaultVariety && defaultVariety.pokemon && defaultVariety.pokemon.url) {
            response = await fetch(defaultVariety.pokemon.url);
          }
        }
      } catch (speciesFallbackErr) {
        console.warn('Error en fallback de especie:', speciesFallbackErr);
      }
    }

    if (!response || !response.ok) {
      mostrarError();
      return;
    }

    const pokemonData = await response.json();

    // Obtener datos complementarios de la especie y evoluciones
    let evolutionData = { previous: [], posterior: [], branches: [] };
    try {
      if (!speciesData && pokemonData.species && pokemonData.species.url) {
        const speciesRes = await fetch(pokemonData.species.url);
        if (speciesRes.ok) {
          speciesData = await speciesRes.json();
        }
      }

      if (speciesData && speciesData.evolution_chain && speciesData.evolution_chain.url) {
        const evoRes = await fetch(speciesData.evolution_chain.url);
        if (evoRes.ok) {
          const evoJson = await evoRes.json();
          evolutionData = await parseEvolutionChain(evoJson.chain, pokemonData.name, speciesData);
        }
      }
    } catch (evoErr) {
      console.warn('No se pudieron obtener datos de especie:', evoErr);
    }

    // Cargar descripciones oficiales de cada habilidad (en qué consiste)
    let abilityDetails = [];
    try {
      abilityDetails = await Promise.all(
        (pokemonData.abilities || []).map(async (a) => {
          const name = a.ability.name;
          const isHidden = a.is_hidden;
          const desc = await getAbilityDescription(a.ability.url, name);
          return {
            name,
            isHidden,
            desc
          };
        })
      );
    } catch (abErr) {
      console.warn('Error al cargar habilidades:', abErr);
    }

    // Cargar detalles de los movimientos principales por nivel (tipo, potencia, precisión, efecto)
    let moveDetails = [];
    try {
      const candidateMoves = [];
      (pokemonData.moves || []).forEach((m) => {
        const vgd = m.version_group_details || [];
        const latest = vgd[vgd.length - 1];
        if (latest && latest.move_learn_method && latest.move_learn_method.name === 'level-up') {
          candidateMoves.push({
            name: m.move.name,
            url: m.move.url,
            level: latest.level_learned_at || 1
          });
        }
      });

      candidateMoves.sort((a, b) => a.level - b.level);

      const targetMoves = candidateMoves.length > 0
        ? candidateMoves.slice(0, 10)
        : (pokemonData.moves || []).slice(0, 8).map((m) => ({ name: m.move.name, url: m.move.url, level: 1 }));

      moveDetails = await Promise.all(
        targetMoves.map(async (m) => {
          const detail = await getMoveDetail(m.url, m.name);
          return {
            ...m,
            ...detail
          };
        })
      );
    } catch (mvErr) {
      console.warn('Error al cargar movimientos:', mvErr);
    }

    renderPokemon(pokemonData, evolutionData, speciesData, abilityDetails, moveDetails);
  } catch (error) {
    mostrarError();
  }
}

// Caché en memoria para movimientos
const moveCache = {};

/**
 * Consulta la PokéAPI para obtener los detalles de combate del movimiento
 * @param {string} url - URL del movimiento
 * @param {string} name - Nombre del movimiento
 * @returns {Promise<Object>} Datos del ataque (tipo, potencia, precisión, pp, efecto)
 */
async function getMoveDetail(url, name) {
  if (moveCache[name]) return moveCache[name];

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar movimiento');
    const data = await res.json();

    const esEntry = data.flavor_text_entries?.find(
      (e) => e.language && e.language.name === 'es'
    );
    const enEntry = data.flavor_text_entries?.find(
      (e) => e.language && e.language.name === 'en'
    );
    const desc = (esEntry || enEntry)?.flavor_text?.replace(/[\f\n\r]/g, ' ') || 'Sin descripción disponible.';

    const damageClass = data.damage_class?.name || 'status';
    const damageClassMap = {
      'physical': 'Físico',
      'special': 'Especial',
      'status': 'Estado'
    };

    const result = {
      type: data.type?.name || 'normal',
      damageClass,
      damageClassLabel: damageClassMap[damageClass] || damageClass,
      power: data.power !== null && data.power !== undefined ? data.power : '—',
      accuracy: data.accuracy !== null && data.accuracy !== undefined ? `${data.accuracy}%` : '—',
      pp: data.pp || '—',
      desc
    };

    moveCache[name] = result;
    return result;
  } catch (e) {
    const fallback = {
      type: 'normal',
      damageClass: 'status',
      damageClassLabel: 'Estado',
      power: '—',
      accuracy: '—',
      pp: '—',
      desc: 'Sin descripción disponible.'
    };
    return fallback;
  }
}

// Caché en memoria para descripciones de habilidades
const abilityCache = {};

/**
 * Consulta la PokéAPI para obtener la descripción en español de en qué consiste la habilidad
 * @param {string} url - URL del endpoint de la habilidad
 * @param {string} name - Nombre de la habilidad
 * @returns {Promise<string>} Explicación del efecto de la habilidad
 */
async function getAbilityDescription(url, name) {
  if (abilityCache[name]) return abilityCache[name];

  try {
    const res = await fetch(url);
    if (!res.ok) return 'Efecto no registrado.';
    const data = await res.json();

    // Buscar entrada en español
    const esEntry = data.flavor_text_entries?.find(
      (e) => e.language && e.language.name === 'es'
    );
    const enEntry = data.flavor_text_entries?.find(
      (e) => e.language && e.language.name === 'en'
    );
    const fallbackEffect = data.effect_entries?.find(
      (e) => e.language && (e.language.name === 'es' || e.language.name === 'en')
    )?.short_effect;

    const desc = (esEntry || enEntry)?.flavor_text?.replace(/[\f\n\r]/g, ' ') || fallbackEffect || 'Sin descripción disponible.';
    abilityCache[name] = desc;
    return desc;
  } catch (e) {
    return 'Sin descripción disponible.';
  }
}

// Caché en memoria para especies completas de la cadena evolutiva
const speciesDataCache = {};

/**
 * Consulta la PokéAPI para obtener datos de especie con caché
 * @param {string} url - URL del endpoint pokemon-species
 * @returns {Promise<Object|null>}
 */
async function fetchSpeciesInfo(url) {
  if (!url) return null;
  if (speciesDataCache[url]) return speciesDataCache[url];
  try {
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      speciesDataCache[url] = json;
      return json;
    }
  } catch (e) {
    console.warn('Error al cargar datos de especie:', e);
  }
  return null;
}

/**
 * Recorre el árbol de la cadena evolutiva considerando variantes y formas (ej. Aegislash Shield y Blade)
 * @param {Object} chain - Nodo raíz de la cadena evolutiva
 * @param {string} targetPokemonName - Nombre de la variedad o especie actual
 * @param {Object|null} currentSpeciesData - Datos de la especie actual si ya se conocen
 * @returns {Promise<{ previous: Array, posterior: Array, branches: Array }>}
 */
async function parseEvolutionChain(chain, targetPokemonName, currentSpeciesData) {
  const normTarget = (targetPokemonName || '').toLowerCase().trim();

  function getSpeciesId(url) {
    const parts = (url || '').split('/').filter(Boolean);
    return parseInt(parts[parts.length - 1], 10) || 0;
  }

  // 1. Extraer todas las especies presentes en el árbol
  const allSpeciesNodes = [];
  function collectSpeciesNodes(node) {
    if (!node || !node.species) return;
    allSpeciesNodes.push(node);
    if (node.evolves_to && Array.isArray(node.evolves_to)) {
      node.evolves_to.forEach(collectSpeciesNodes);
    }
  }
  collectSpeciesNodes(chain);

  // 2. Precargar en paralelo los datos de especie para resolver sus variedades
  const speciesMap = {};
  await Promise.all(
    allSpeciesNodes.map(async (node) => {
      const sName = node.species.name.toLowerCase();
      if (currentSpeciesData && (currentSpeciesData.name || '').toLowerCase() === sName) {
        speciesMap[sName] = currentSpeciesData;
      } else {
        const data = await fetchSpeciesInfo(node.species.url);
        if (data) speciesMap[sName] = data;
      }
    })
  );

  // 3. Función auxiliar para expandir un nodo de especie en sus variantes canónicas
  function getVarietiesForNode(node) {
    const sName = node.species.name.toLowerCase();
    const spData = speciesMap[sName];
    const defaultId = getSpeciesId(node.species.url);
    const capSpecies = sName.charAt(0).toUpperCase() + sName.slice(1);

    if (!spData || !spData.varieties || spData.varieties.length === 0) {
      return [{
        name: sName,
        speciesName: sName,
        id: defaultId,
        label: capSpecies,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${defaultId}.png`
      }];
    }

    // Filtrar formas cosméticas especiales como totem, gorras o gmax/mega si no son permanentes
    const canonicalVars = spData.varieties.filter((v) => {
      const vName = (v.pokemon?.name || '').toLowerCase();
      if (vName.includes('-totem') || vName.includes('-cap') || vName.includes('-starter') || vName.includes('-battle-bond')) return false;
      if (vName.includes('-mega') || vName.includes('-gmax')) return false;
      return true;
    });

    if (canonicalVars.length <= 1) {
      const v = canonicalVars[0] || spData.varieties[0];
      const vName = v.pokemon.name;
      const vId = getSpeciesId(v.pokemon.url) || defaultId;
      return [{
        name: vName,
        speciesName: sName,
        id: vId,
        label: capSpecies,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${vId}.png`
      }];
    }

    // Múltiples variantes canónicas (ej. Aegislash Shield y Blade, Lycanroc Midday/Midnight/Dusk, etc.)
    return canonicalVars.map((v) => {
      const vName = v.pokemon.name;
      const vId = getSpeciesId(v.pokemon.url) || defaultId;
      let label = capSpecies;
      if (vName.toLowerCase() !== sName) {
        const suffix = vName.toLowerCase().replace(`${sName}-`, '');
        const formCap = suffix.charAt(0).toUpperCase() + suffix.slice(1);
        label = `${capSpecies} (${formCap})`;
      } else if (v.is_default) {
        label = `${capSpecies} (Shield)`;
      }

      return {
        name: vName,
        speciesName: sName,
        id: vId,
        label,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${vId}.png`
      };
    });
  }

  // 4. Identificar a qué especie pertenece el objetivo actual
  let currentSpeciesName = (currentSpeciesData?.name || '').toLowerCase();
  if (!currentSpeciesName) {
    for (const node of allSpeciesNodes) {
      const vars = getVarietiesForNode(node);
      if (node.species.name.toLowerCase() === normTarget || vars.some((v) => v.name.toLowerCase() === normTarget || String(v.id) === normTarget)) {
        currentSpeciesName = node.species.name.toLowerCase();
        break;
      }
    }
  }

  let pathToTarget = [];
  let targetNode = null;

  function findPath(node, currentPath) {
    if (!node || !node.species) return false;
    const newPath = [...currentPath, node];

    if (node.species.name.toLowerCase() === currentSpeciesName) {
      pathToTarget = newPath;
      targetNode = node;
      return true;
    }

    if (node.evolves_to && Array.isArray(node.evolves_to)) {
      for (const child of node.evolves_to) {
        if (findPath(child, newPath)) return true;
      }
    }
    return false;
  }

  findPath(chain, []);

  // 5. Construir Anteriores (Ancestros en pathToTarget)
  const previous = [];
  const pathToTargetSpecies = new Set(pathToTarget.map((n) => n.species.name.toLowerCase()));

  for (let i = 0; i < pathToTarget.length - 1; i++) {
    const pNode = pathToTarget[i];
    const vars = getVarietiesForNode(pNode);
    vars.forEach((v) => {
      previous.push({ ...v, role: 'prev' });
    });
  }

  // 6. Variantes del nodo actual (ej. Aegislash Shield vs Blade)
  const targetVars = targetNode ? getVarietiesForNode(targetNode) : [];
  let currentMatchedVar = targetVars.find((v) => v.name.toLowerCase() === normTarget || String(v.id) === normTarget);
  if (!currentMatchedVar && targetVars.length > 0) {
    currentMatchedVar = targetVars[0];
  }

  const branches = [];
  targetVars.forEach((v) => {
    if (currentMatchedVar && v.name.toLowerCase() !== currentMatchedVar.name.toLowerCase()) {
      branches.push({ ...v, role: 'branch' });
    }
  });

  // 7. Posteriores (Descendientes del nodo actual, con todas sus variantes expandidas)
  const posterior = [];
  const posteriorSpecies = new Set();

  function collectDescendants(node) {
    if (!node || !node.evolves_to || !Array.isArray(node.evolves_to)) return;
    for (const child of node.evolves_to) {
      const childSpecies = child.species.name.toLowerCase();
      posteriorSpecies.add(childSpecies);
      const vars = getVarietiesForNode(child);
      vars.forEach((v) => {
        posterior.push({ ...v, role: 'next' });
      });
      collectDescendants(child);
    }
  }

  if (targetNode) {
    collectDescendants(targetNode);
  }

  // 8. Ramas alternativas en otras especies del árbol (ej. Bellossom cuando el actual es Vileplume)
  allSpeciesNodes.forEach((node) => {
    const sName = node.species.name.toLowerCase();
    if (sName !== currentSpeciesName && !pathToTargetSpecies.has(sName) && !posteriorSpecies.has(sName)) {
      const vars = getVarietiesForNode(node);
      vars.forEach((v) => {
        branches.push({ ...v, role: 'branch' });
      });
    }
  });

  return { previous, posterior, branches, currentMatchedVar };
}

/**
 * Renderiza los datos del Pokémon en pestañas interactivas (Datos, Estadísticas, Evolución, Movimientos)
 * @param {Object} data - Datos obtenidos de la PokéAPI
 * @param {{ previous: Array, posterior: Array }} evolutionData - Evoluciones calculadas
 * @param {Object|null} speciesData - Datos de especie
 */
function renderPokemon(data, evolutionData = { previous: [], posterior: [] }, speciesData = null, abilityDetails = [], moveDetails = []) {
  if (!pokedexContainer) return;

  const normalSprite = data.sprites.front_default || '';
  const shinySprite = data.sprites.front_shiny || normalSprite;
  const rawName = data.name || '';
  let capitalizedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  if (speciesData) {
    const esNameObj = (speciesData.names || []).find((n) => n.language && n.language.name === 'es');
    const baseSpeciesName = esNameObj?.name || (speciesData.name.charAt(0).toUpperCase() + speciesData.name.slice(1));
    const spName = (speciesData.name || '').toLowerCase();
    const rawLower = rawName.toLowerCase();

    if (rawLower.includes('-') && !rawLower.startsWith('ho-oh') && !rawLower.startsWith('porygon-z') && !rawLower.startsWith('jangmo-o') && !rawLower.startsWith('hakamo-o') && !rawLower.startsWith('kommo-o')) {
      const suffix = rawLower.replace(`${spName}-`, '');
      if (suffix && suffix !== rawLower) {
        const formCap = suffix.charAt(0).toUpperCase() + suffix.slice(1);
        capitalizedName = `${baseSpeciesName} (${formCap})`;
      } else {
        capitalizedName = baseSpeciesName;
      }
    } else {
      capitalizedName = baseSpeciesName;
    }
  }
  const pokemonId = data.id;
  const weight = data.weight;
  const weightInKg = (weight / 10).toFixed(1);
  const firstType = data.types && data.types.length > 0 ? data.types[0].type.name : 'normal';
  const heightInMeters = data.height ? (data.height / 10).toFixed(1) : '-';

  // Tipos (soporte para tipos duales)
  const allTypesHtml = (data.types || []).map((t) => {
    return `<span class="type-indicator type-${t.type.name}">${t.type.name}</span>`;
  }).join(' ');

  // Descripción de la Pokédex (en español de preferencia)
  let flavorText = '';
  if (speciesData && speciesData.flavor_text_entries) {
    const esText = speciesData.flavor_text_entries.find((e) => e.language && e.language.name === 'es');
    const enText = speciesData.flavor_text_entries.find((e) => e.language && e.language.name === 'en');
    flavorText = (esText || enText)?.flavor_text?.replace(/[\f\n\r]/g, ' ') || '';
  }

  // Categoría / Especie (Genus)
  let genus = '';
  if (speciesData && speciesData.genera) {
    const esGenus = speciesData.genera.find((g) => g.language && g.language.name === 'es');
    const enGenus = speciesData.genera.find((g) => g.language && g.language.name === 'en');
    genus = (esGenus || enGenus)?.genus || '';
  }

  // Habilidades con explicación detallada de en qué consiste cada una
  const abilitiesHtml = (abilityDetails || []).map((ab) => {
    const cleanName = ab.name.replace(/-/g, ' ');
    const capName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    const badgeHtml = ab.isHidden
      ? '<span class="ability-role-badge hidden">Oculta</span>'
      : '<span class="ability-role-badge normal">Principal</span>';

    return `
      <div class="ability-card">
        <div class="ability-card-header">
          <span class="ability-name">${capName}</span>
          ${badgeHtml}
        </div>
        <p class="ability-desc">${ab.desc}</p>
      </div>
    `;
  }).join('');

  // Estadísticas Base
  const statLabels = {
    'hp': 'PS',
    'attack': 'Ataque',
    'defense': 'Defensa',
    'special-attack': 'Atq. Esp.',
    'special-defense': 'Def. Esp.',
    'speed': 'Velocidad'
  };

  let bstTotal = 0;
  const statsRowsHtml = (data.stats || []).map((s) => {
    const val = s.base_stat;
    bstTotal += val;
    const label = statLabels[s.stat.name] || s.stat.name;
    const pct = Math.min(100, Math.round((val / 220) * 100));
    let colorClass = 'low';
    if (val >= 85) colorClass = 'high';
    else if (val >= 55) colorClass = 'medium';

    return `
      <div class="stat-row">
        <span class="stat-name">${label}</span>
        <span class="stat-num">${val}</span>
        <div class="stat-bar-track">
          <div class="stat-bar-fill ${colorClass}" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  // Renderizado del mazo de movimientos con nivel, tipo, potencia, precisión y descripción
  let movesHtml = '';
  if (moveDetails && moveDetails.length > 0) {
    movesHtml = `
      <div class="moves-container">
        <div class="moves-header-info">
          <span class="moves-subtitle">Aprendidos por Nivel</span>
          <span class="moves-count">${moveDetails.length} movimientos</span>
        </div>
        <div class="moves-list">
          ${moveDetails.map((m) => {
            const cleanName = m.name.replace(/-/g, ' ');
            const capName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
            return `
              <div class="move-card">
                <div class="move-card-top">
                  <div class="move-main-info">
                    <span class="move-level-badge">Nv. ${m.level}</span>
                    <span class="move-name">${capName}</span>
                  </div>
                  <div class="move-tags">
                    <span class="type-indicator type-${m.type}" style="font-size:0.68rem; padding:1px 6px;">${m.type}</span>
                    <span class="move-damage-class ${m.damageClass}">${m.damageClassLabel}</span>
                  </div>
                </div>
                <div class="move-stats-row">
                  <span class="move-stat-item">Potencia: <strong>${m.power}</strong></span>
                  <span class="move-stat-item">Precisión: <strong>${m.accuracy}</strong></span>
                  <span class="move-stat-item">PP: <strong>${m.pp}</strong></span>
                </div>
                <p class="move-desc-text">${m.desc}</p>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else {
    movesHtml = '<p style="text-align:center; color:#94a3b8; padding:16px;">Sin movimientos disponibles para este Pokémon.</p>';
  }

  // Audio del grito (Cries)
  const cryAudioUrl = data.cries?.latest || data.cries?.legacy || '';
  const cryButtonHtml = cryAudioUrl ? `
    <button type="button" class="cry-btn" id="poke-cry-btn" title="Escuchar grito de ${capitalizedName}" aria-label="Escuchar grito">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    </button>
  ` : '';

  // Riel Evolutivo único
  const evolutionsHtml = buildEvolutionsHtml(data, evolutionData);

  // Barra de variantes o formas alternas (ej. Aegislash Shield y Blade, Deoxys, Lycanroc, etc.)
  let formsBarHtml = '';
  if (speciesData && speciesData.varieties && speciesData.varieties.length > 1) {
    const canonicalVars = speciesData.varieties.filter((v) => {
      const vName = (v.pokemon?.name || '').toLowerCase();
      if (vName.includes('-totem') || vName.includes('-cap') || vName.includes('-starter') || vName.includes('-battle-bond')) return false;
      if (vName.includes('-mega') || vName.includes('-gmax')) return false;
      return true;
    });

    if (canonicalVars.length > 1) {
      const spBaseName = speciesData.name.toLowerCase();
      const capBase = spBaseName.charAt(0).toUpperCase() + spBaseName.slice(1);

      const chipsHtml = canonicalVars.map((v) => {
        const vName = v.pokemon.name.toLowerCase();
        const vId = (v.pokemon.url || '').split('/').filter(Boolean).pop();
        const isCurrent = (vName === rawName.toLowerCase() || String(vId) === String(pokemonId));

        let formLabel = capBase;
        if (vName !== spBaseName) {
          const suffix = vName.replace(`${spBaseName}-`, '');
          formLabel = suffix.charAt(0).toUpperCase() + suffix.slice(1);
        } else if (v.is_default) {
          formLabel = 'Shield';
        }

        return `
          <button
            type="button"
            class="form-chip-btn ${isCurrent ? 'active' : ''}"
            data-pokemon="${vId || vName}"
            aria-pressed="${isCurrent ? 'true' : 'false'}"
            title="Forma ${formLabel}"
          >
            ${formLabel} ${isCurrent ? '●' : ''}
          </button>
        `;
      }).join('');

      formsBarHtml = `
        <div class="pokemon-forms-bar" role="region" aria-label="Variantes y formas del Pokémon">
          <span class="forms-bar-title">FORMAS:</span>
          <div class="forms-chips-wrap">
            ${chipsHtml}
          </div>
        </div>
      `;
    }
  }

  // Estado de colección en localStorage
  const isSavedInCol = isPokemonInCollection(data.id);
  const collectionBtnHtml = `
    <button
      type="button"
      class="collection-toggle-btn ${isSavedInCol ? 'in-collection' : ''}"
      id="collection-toggle-btn"
      title="${isSavedInCol ? 'Eliminar de mi colección' : 'Guardar en mi colección'}"
      aria-pressed="${isSavedInCol ? 'true' : 'false'}"
    >
      <span class="star-icon">${isSavedInCol ? '★' : '☆'}</span>
      <span class="collection-btn-txt">${isSavedInCol ? 'Guardado' : 'Coleccionar'}</span>
    </button>
  `;

  // Inyección del markup completo con pestañas
  pokedexContainer.innerHTML = `
    <article class="pokemon-card">
      <div class="pokemon-header-info">
        <div class="pokemon-header-left">
          <h2 class="pokemon-name">${capitalizedName}</h2>
          ${cryButtonHtml}
          <button type="button" class="tcg-value-btn" id="poke-tcg-btn" title="Consultar valores de cartas en el mercado TCG de ${capitalizedName}" aria-label="Ver valores de cartas Pokémon TCG">
            <span class="tcg-btn-icon">🃏</span>
            <span>Valor</span>
          </button>
          ${collectionBtnHtml}
        </div>
        <span class="pokemon-id">#${String(pokemonId).padStart(3, '0')}</span>
      </div>

      <div class="sprite-stage" id="sprite-stage" title="Toca la imagen para ver evoluciones en burbujas" role="button" aria-haspopup="dialog" aria-label="Ver evoluciones de ${capitalizedName}">
        <span class="sprite-click-hint">🫧 Ver Evoluciones</span>
        <img
          class="pokemon-sprite"
          id="main-pokemon-sprite"
          src="${normalSprite}"
          alt="Sprite de ${capitalizedName}"
          loading="lazy"
        />
        <button type="button" class="shiny-toggle-btn" id="shiny-toggle-btn" aria-label="Alternar versión variocolor">
          <span>★</span>
          <span>Shiny</span>
        </button>
      </div>

      ${formsBarHtml}

      <!-- Barra de Pestañas -->
      <nav class="pokemon-tabs-nav" role="tablist" aria-label="Información del Pokémon">
        <button type="button" class="poke-tab-btn active" data-tab="info" role="tab" aria-selected="true">
          📋 Datos
        </button>
        <button type="button" class="poke-tab-btn" data-tab="stats" role="tab" aria-selected="false">
          📊 Estadísticas
        </button>
        <button type="button" class="poke-tab-btn" data-tab="evolutions" role="tab" aria-selected="false">
          🧬 Evolución
        </button>
        <button type="button" class="poke-tab-btn" data-tab="moves" role="tab" aria-selected="false">
          ⚔️ Movimientos
        </button>
      </nav>

      <!-- Panel 1: Datos Generales -->
      <div class="tab-panel active" id="tab-panel-info" role="tabpanel">
        ${flavorText ? `<div class="flavor-text-card">"${flavorText}"</div>` : ''}

        <div class="pokemon-data-grid">
          <div class="data-box">
            <span class="data-label">ID</span>
            <span class="data-value">#${pokemonId}</span>
          </div>

          <div class="data-box">
            <span class="data-label">Tipo</span>
            <div class="data-value types-badge-row">
              ${allTypesHtml}
            </div>
          </div>

          <div class="data-box">
            <span class="data-label">Peso</span>
            <span class="data-value">${weightInKg} kg <small style="font-weight:400;color:#64748b;">(${weight})</small></span>
          </div>

          <div class="data-box">
            <span class="data-label">Altura</span>
            <span class="data-value">${heightInMeters} m</span>
          </div>
        </div>

        ${genus ? `
          <div class="data-box" style="flex-direction:row; justify-content:space-between; padding:8px 14px;">
            <span class="data-label">Especie</span>
            <span style="font-weight:700; font-size:0.85rem; color:#1e293b;">${genus}</span>
          </div>
        ` : ''}

        <div class="data-box" style="align-items:flex-start; padding:10px 14px;">
          <span class="data-label" style="margin-bottom:6px;">Habilidades y Efectos</span>
          <div class="abilities-list">
            ${abilitiesHtml || '<p style="color:#94a3b8; font-size:0.75rem;">No registradas</p>'}
          </div>
        </div>
      </div>

      <!-- Panel 2: Estadísticas Base -->
      <div class="tab-panel" id="tab-panel-stats" role="tabpanel">
        <div class="stats-container">
          ${statsRowsHtml}
          <div class="bst-row">
            <span>Total Base (BST)</span>
            <span class="bst-val">${bstTotal}</span>
          </div>
        </div>
      </div>

      <!-- Panel 3: Cadena Evolutiva en un solo riel -->
      <div class="tab-panel" id="tab-panel-evolutions" role="tabpanel">
        ${evolutionsHtml}
      </div>

      <!-- Panel 4: Movimientos -->
      <div class="tab-panel" id="tab-panel-moves" role="tabpanel">
        <div class="moves-grid">
          ${movesHtml || '<p style="grid-column:1/-1; text-align:center; color:#94a3b8; padding:12px;">Sin movimientos disponibles.</p>'}
        </div>
      </div>
    </article>
  `;

  // 1. Alternancia de pestañas
  const tabButtons = pokedexContainer.querySelectorAll('.poke-tab-btn');
  const tabPanels = pokedexContainer.querySelectorAll('.tab-panel');

  tabButtons.forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      playRetroBeep('click');
      const targetTab = tabBtn.getAttribute('data-tab');

      tabButtons.forEach((b) => {
        const isSelected = b === tabBtn;
        b.classList.toggle('active', isSelected);
        b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });

      tabPanels.forEach((panel) => {
        const isMatch = panel.id === `tab-panel-${targetTab}`;
        panel.classList.toggle('active', isMatch);
      });
    });
  });

  // 2. Reproducción del grito de audio
  if (cryAudioUrl) {
    const cryBtn = document.getElementById('poke-cry-btn');
    if (cryBtn) {
      cryBtn.addEventListener('click', () => {
        try {
          const audio = new Audio(cryAudioUrl);
          audio.volume = 0.5;
          audio.play().catch(() => {});
        } catch (e) {
          console.warn('Audio no reproducible:', e);
        }
      });
    }
  }

  // 3. Alternador de versión Shiny
  const shinyToggleBtn = document.getElementById('shiny-toggle-btn');
  const mainSpriteImg = document.getElementById('main-pokemon-sprite');
  let isShiny = false;

  if (shinyToggleBtn && mainSpriteImg) {
    shinyToggleBtn.addEventListener('click', () => {
      playRetroBeep('click');
      isShiny = !isShiny;
      mainSpriteImg.src = isShiny ? shinySprite : normalSprite;
      shinyToggleBtn.classList.toggle('is-active', isShiny);
      shinyToggleBtn.title = isShiny ? 'Mostrando versión Variocolor' : 'Mostrando versión Normal';
    });
  }

  // 4. Clic en la imagen para desplegar burbujas de evolución flotantes
  const spriteStage = document.getElementById('sprite-stage');
  if (spriteStage) {
    spriteStage.addEventListener('click', (event) => {
      // Evitar que el clic en el botón shiny abra las burbujas
      if (event.target.closest('#shiny-toggle-btn')) return;
      if (event.target.closest('.evolution-bubbles-overlay')) return;
      playRetroBeep('open');
      mostrarBurbujasEvolucion(data, evolutionData);
    });
  }

  // 5. Navegación en el riel evolutivo
  const evoButtons = pokedexContainer.querySelectorAll('.evo-card-btn:not(.is-current)');
  evoButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetPokemon = btn.getAttribute('data-pokemon');
      if (targetPokemon && searchInput) {
        searchInput.value = targetPokemon;
        searchPokemon();
        pokedexContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  // 6. Cambio rápido entre variantes / formas alternas (ej. Aegislash Shield y Blade)
  const formChips = pokedexContainer.querySelectorAll('.form-chip-btn:not(.active)');
  formChips.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetPokemon = btn.getAttribute('data-pokemon');
      if (targetPokemon && searchInput) {
        playRetroBeep('click');
        searchInput.value = targetPokemon;
        searchPokemon();
      }
    });
  });

  // 7. Consulta de valor de mercado en Pokémon TCG (solo al pulsar el botón "Valor")
  const tcgBtn = document.getElementById('poke-tcg-btn');
  if (tcgBtn) {
    tcgBtn.addEventListener('click', () => {
      const searchName = speciesData?.name || data.name;
      abrirModalValorTCG(searchName);
    });
  }

  // 8. Botón para alternar guardado en Colección personal
  const colBtn = document.getElementById('collection-toggle-btn');
  if (colBtn) {
    colBtn.addEventListener('click', () => {
      const isNowSaved = togglePokemonInCollection({
        id: data.id,
        name: data.name,
        displayName: capitalizedName,
        sprite: normalSprite,
        types: (data.types || []).map((t) => t.type.name)
      });
      playRetroBeep('click');
      colBtn.classList.toggle('in-collection', isNowSaved);
      colBtn.setAttribute('aria-pressed', isNowSaved ? 'true' : 'false');
      colBtn.title = isNowSaved ? 'Eliminar de mi colección' : 'Guardar en mi colección';
      const starIcon = colBtn.querySelector('.star-icon');
      if (starIcon) starIcon.textContent = isNowSaved ? '★' : '☆';
      const btnTxt = colBtn.querySelector('.collection-btn-txt');
      if (btnTxt) btnTxt.textContent = isNowSaved ? 'Guardado' : 'Coleccionar';
    });
  }
}

/* ==========================================================================
   Gestión de Colección de Pokémon (Almacenamiento Local en localStorage)
   ========================================================================== */
const STORAGE_KEY_COLLECTION = 'pokemon_user_collection';

function getCollection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLECTION);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCollection(items) {
  try {
    localStorage.setItem(STORAGE_KEY_COLLECTION, JSON.stringify(items));
  } catch (e) {}
  updateCollectionBadges();
}

function isPokemonInCollection(idOrName) {
  const col = getCollection();
  const target = String(idOrName).toLowerCase().trim();
  return col.some((p) => String(p.id) === target || (p.name || '').toLowerCase() === target);
}

function togglePokemonInCollection(pokemon) {
  let col = getCollection();
  const idStr = String(pokemon.id);
  const exists = col.some((p) => String(p.id) === idStr);
  if (exists) {
    col = col.filter((p) => String(p.id) !== idStr);
  } else {
    col.unshift({
      id: pokemon.id,
      name: pokemon.name,
      displayName: pokemon.displayName || pokemon.name,
      sprite: pokemon.sprite,
      types: pokemon.types || [],
      addedAt: Date.now()
    });
  }
  saveCollection(col);
  return !exists;
}

function removePokemonFromCollection(id) {
  let col = getCollection();
  col = col.filter((p) => String(p.id) !== String(id));
  saveCollection(col);
}

function clearEntireCollection() {
  saveCollection([]);
}

function updateCollectionBadges() {
  const count = getCollection().length;
  const badge = document.getElementById('collection-count-badge');
  if (badge) {
    badge.textContent = String(count);
  }
}

/**
 * Despliega el modal interactivo con la colección de Pokémon guardados en localStorage
 */
function abrirModalColeccion() {
  playRetroBeep('open');

  const existing = document.getElementById('collection-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tcg-modal-overlay';
  overlay.id = 'collection-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mi Colección Pokémon');

  function renderCollectionContent() {
    const collection = getCollection();
    const totalCount = collection.length;

    overlay.innerHTML = `
      <div class="tcg-modal-card">
        <div class="tcg-modal-header">
          <div class="tcg-header-title-wrap">
            <span class="tcg-header-kicker">ALMACENAMIENTO LOCAL</span>
            <h3 class="tcg-modal-title">⭐ Mi Colección (${totalCount})</h3>
          </div>
          <div class="tcg-header-actions">
            ${totalCount > 0 ? `<button type="button" class="clear-all-btn" id="clear-col-btn" title="Eliminar todos los Pokémon guardados">🗑️ Limpiar Todo</button>` : ''}
            <button type="button" class="tcg-close-btn" id="close-col-modal" aria-label="Cerrar modal">✕</button>
          </div>
        </div>
        <div class="tcg-modal-body" id="col-modal-body">
          ${totalCount === 0 ? `
            <div class="tcg-empty-box">
              <span style="font-size:2.2rem;">⭐</span>
              <p>Tu colección de Pokémon está vacía.</p>
              <span style="font-size:0.75rem; color:#64748b;">Pulsa el botón <strong>☆ Coleccionar</strong> en la ficha de cualquier Pokémon para guardarlo aquí en tu navegador.</span>
            </div>
          ` : `
            <div class="collection-cards-grid">
              ${collection.map((p) => {
                const typeBadges = (p.types || []).map((t) => `<span class="pokemon-type-badge type-${t}">${t}</span>`).join('');
                return `
                  <div class="collection-card-item" data-pokemon="${p.name || p.id}" title="Ver ficha de ${p.displayName || p.name}">
                    <button type="button" class="collection-delete-btn" data-delete-id="${p.id}" title="Eliminar de mi colección">✕</button>
                    <img class="collection-thumb" src="${p.sprite}" alt="${p.displayName || p.name}" loading="lazy" />
                    <div class="collection-info">
                      <span class="collection-name">${p.displayName || p.name}</span>
                      <span class="collection-id">#${String(p.id).padStart(3, '0')}</span>
                      <div class="collection-types">${typeBadges}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
        <div class="tcg-modal-footer">
          <span class="tcg-footer-note">Guardado permanentemente en este navegador (localStorage)</span>
        </div>
      </div>
    `;

    // Cerrar
    const closeBtn = overlay.querySelector('#close-col-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Limpiar todo
    const clearBtn = overlay.querySelector('#clear-col-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        playRetroBeep('error');
        clearEntireCollection();
        renderCollectionContent();
        // Si el Pokémon actual está en pantalla, actualizar su botón
        const currentToggle = document.getElementById('collection-toggle-btn');
        if (currentToggle) {
          currentToggle.classList.remove('in-collection');
          currentToggle.setAttribute('aria-pressed', 'false');
          currentToggle.title = 'Guardar en mi colección';
          const star = currentToggle.querySelector('.star-icon');
          if (star) star.textContent = '☆';
          const txt = currentToggle.querySelector('.collection-btn-txt');
          if (txt) txt.textContent = 'Coleccionar';
        }
      });
    }

    // Navegar al hacer clic en un Pokémon
    overlay.querySelectorAll('.collection-card-item').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.collection-delete-btn')) return;
        const target = card.getAttribute('data-pokemon');
        if (target && searchInput) {
          playRetroBeep('click');
          closeModal();
          searchInput.value = target;
          searchPokemon();
          if (pokedexContainer) {
            pokedexContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    });

    // Eliminar individual
    overlay.querySelectorAll('.collection-delete-btn').forEach((delBtn) => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playRetroBeep('click');
        const idToDelete = delBtn.getAttribute('data-delete-id');
        removePokemonFromCollection(idToDelete);
        renderCollectionContent();

        // Actualizar botón si el actual es el eliminado
        const currentToggle = document.getElementById('collection-toggle-btn');
        if (currentToggle) {
          const currentId = pokedexContainer.querySelector('.pokemon-id')?.textContent?.replace('#', '');
          if (currentId && String(parseInt(currentId, 10)) === String(idToDelete)) {
            currentToggle.classList.remove('in-collection');
            currentToggle.setAttribute('aria-pressed', 'false');
            currentToggle.title = 'Guardar en mi colección';
            const star = currentToggle.querySelector('.star-icon');
            if (star) star.textContent = '☆';
            const txt = currentToggle.querySelector('.collection-btn-txt');
            if (txt) txt.textContent = 'Coleccionar';
          }
        }
      });
    });
  }

  let isClosing = false;
  const closeModal = () => {
    if (isClosing) return;
    isClosing = true;
    overlay.classList.add('closing');
    document.removeEventListener('keydown', handleEsc);
    setTimeout(() => {
      overlay.remove();
    }, 180);
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeModal();
  };

  document.addEventListener('keydown', handleEsc);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  renderCollectionContent();
  document.body.appendChild(overlay);
}

/* ==========================================================================
   Gestión de Carrito de Compras TCG (Almacenamiento Local en localStorage)
   ========================================================================== */
const STORAGE_KEY_CART = 'pokemon_tcg_cart';

// Variable para recordar la última consulta de cartas y permitir regresar desde el carrito
let lastTcgPokemonSearch = 'pikachu';

/**
 * Normaliza la URL de imagen de una carta de TCGdex evitando rutas duplicadas o rotas
 * @param {string} raw
 * @returns {string}
 */
function resolveCardImg(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // Limpiar posibles duplicaciones previas guardadas en localStorage
  s = s.replace(/(\/high\.(webp|png))+/g, '/high.webp');
  s = s.replace(/(\/low\.(webp|png))+/g, '/low.webp');
  if (s.endsWith('.webp') || s.endsWith('.png') || s.endsWith('.jpg')) {
    return s;
  }
  return `${s}/high.webp`;
}

function getCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CART);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(STORAGE_KEY_CART, JSON.stringify(cart));
  } catch (e) {}
  updateCartBadges();
}

function addToCart(item) {
  const cart = getCart();
  const existing = cart.find((i) => i.id === item.id);
  const cleanImg = resolveCardImg(item.image);
  const origin = item.pokemonOrigin || lastTcgPokemonSearch || (typeof localStorage !== 'undefined' ? localStorage.getItem('tcg_active_pokemon_origin') : null) || 'pikachu';

  try {
    localStorage.setItem('tcg_active_pokemon_origin', origin);
  } catch (e) {}

  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
    if (!existing.image || existing.image.includes('/high.webp/')) {
      existing.image = cleanImg;
    }
    if (!existing.pokemonOrigin) {
      existing.pokemonOrigin = origin;
    }
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      setName: item.setName || 'Colección TCG',
      rarity: item.rarity || 'Común',
      image: cleanImg,
      priceUsd: Number(item.priceUsd) || 0,
      priceMxn: Number(item.priceMxn) || 0,
      quantity: 1,
      pokemonOrigin: origin
    });
  }
  saveCart(cart);
}

function updateCartItemQty(cardId, delta) {
  let cart = getCart();
  const item = cart.find((i) => i.id === cardId);
  if (!item) return;
  item.quantity = (item.quantity || 1) + delta;
  if (item.quantity <= 0) {
    cart = cart.filter((i) => i.id !== cardId);
  }
  saveCart(cart);
}

function removeFromCart(cardId) {
  let cart = getCart();
  cart = cart.filter((i) => i.id !== cardId);
  saveCart(cart);
}

function clearCart() {
  saveCart([]);
}

function updateCartBadges() {
  const cart = getCart();
  const totalItems = cart.reduce((sum, i) => sum + (i.quantity || 1), 0);
  const badge = document.getElementById('cart-count-badge');
  if (badge) {
    badge.textContent = String(totalItems);
  }
  const modalCartNum = document.getElementById('tcg-modal-cart-num');
  if (modalCartNum) {
    modalCartNum.textContent = String(totalItems);
  }
}

/**
 * Despliega el modal interactivo del Portafolio TCG (Seguimiento de Inversión Informativo)
 */
function abrirModalPortafolio() {
  playRetroBeep('open');

  const existing = document.getElementById('cart-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tcg-modal-overlay';
  overlay.id = 'cart-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Portafolio de cartas TCG');

  let isClosing = false;
  const closeModal = () => {
    if (isClosing) return;
    isClosing = true;
    overlay.classList.add('closing');
    document.removeEventListener('keydown', handleEsc);
    setTimeout(() => {
      overlay.remove();
    }, 180);
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeModal();
  };

  function renderCartContent() {
    const cart = getCart();
    const totalItems = cart.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const totalMxn = cart.reduce((sum, i) => sum + ((i.priceMxn || 0) * (i.quantity || 1)), 0);
    const totalUsd = cart.reduce((sum, i) => sum + ((i.priceUsd || 0) * (i.quantity || 1)), 0);
    const lastPoke = lastTcgPokemonSearch || 'pikachu';
    const lastCap = lastPoke.charAt(0).toUpperCase() + lastPoke.slice(1);

    overlay.innerHTML = `
      <div class="tcg-modal-card">
        <div class="tcg-modal-header">
          <div class="tcg-header-title-wrap">
            <span class="tcg-header-kicker">SEGUIMIENTO DE INVERSIÓN POKÉMON TCG</span>
            <h3 class="tcg-modal-title">💼 Portafolio TCG (${totalItems} cartas)</h3>
          </div>
          <div class="tcg-header-actions">
            <button type="button" class="cart-back-btn" id="cart-back-to-cards-btn" title="Regresar al catálogo de cartas de ${lastCap}">
              ← Volver a Cartas
            </button>
            ${totalItems > 0 ? `<button type="button" class="clear-all-btn" id="clear-cart-btn" title="Vaciar todas las cartas del portafolio">🗑️ Vaciar</button>` : ''}
            <button type="button" class="tcg-close-btn" id="close-cart-modal" aria-label="Cerrar portafolio">✕</button>
          </div>
        </div>
        <div class="tcg-modal-body" id="cart-modal-body">
          ${totalItems === 0 ? `
            <div class="tcg-empty-box">
              <span style="font-size:2.4rem;">💼</span>
              <p>Tu Portafolio TCG está vacío.</p>
              <span style="font-size:0.75rem; color:#64748b; max-width:440px; line-height:1.4;">
                Esta herramienta es informativa: pulsa <strong>💼 + Portafolio</strong> en el mercado de cartas de cualquier Pokémon para calcular tu inversión estimada y dar seguimiento a su valor.
              </span>
              <button type="button" class="cart-back-btn" id="empty-back-btn" style="margin-top:14px; padding:7px 14px; font-size:0.72rem; background:#fef08a; color:#854d0e; border-color:#ca8a04;">
                ← Ver Cartas de ${lastCap}
              </button>
            </div>
          ` : `
            <div class="cart-items-list">
              ${cart.map((item) => {
                const subtotalMxn = (item.priceMxn || 0) * (item.quantity || 1);
                const resolvedImg = resolveCardImg(item.image);
                const itemOrigin = item.pokemonOrigin || lastPoke;
                const itemOriginCap = itemOrigin.charAt(0).toUpperCase() + itemOrigin.slice(1);

                return `
                  <div class="cart-item-row">
                    <img
                      class="cart-item-img"
                      src="${resolvedImg}"
                      alt="${item.name}"
                      loading="lazy"
                      onerror="this.onerror=null; if(this.src.endsWith('.webp')){ this.src = this.src.replace('.webp', '.png'); }"
                      title="Clic para ir a las cartas de este Pokémon"
                    />
                    <div class="cart-item-details">
                      <span class="cart-item-name" title="${item.name}">${item.name}</span>
                      <span class="cart-item-set">${item.setName} · ${item.rarity}</span>
                      <span class="cart-item-unit-price">$${(item.priceMxn || 0).toFixed(2)} MXN c/u <small style="color:#64748b;">(≈ $${(item.priceUsd || 0).toFixed(2)} USD)</small></span>
                      <button type="button" class="cart-poke-origin-btn" data-poke="${itemOrigin}" title="Ir a la ficha de ${itemOriginCap} en la Pokédex y ver sus cartas">
                        <span>🔍</span>
                        <span>Ver cartas de ${itemOriginCap}</span>
                      </button>
                    </div>
                    <div class="cart-qty-ctrl">
                      <button type="button" class="cart-qty-btn" data-qty-change="-1" data-card-id="${item.id}" title="Disminuir copias en seguimiento">-</button>
                      <span class="cart-qty-num" title="Copias en seguimiento">${item.quantity || 1}</span>
                      <button type="button" class="cart-qty-btn" data-qty-change="1" data-card-id="${item.id}" title="Aumentar copias en seguimiento">+</button>
                    </div>
                    <div class="cart-item-subtotal">
                      $${subtotalMxn.toFixed(2)} MXN
                    </div>
                    <button type="button" class="cart-item-delete-btn" data-delete-card-id="${item.id}" title="Quitar de portafolio">🗑️</button>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="cart-summary-box">
              <div class="cart-summary-row">
                <span class="cart-summary-label">Valuación total estimada (${totalItems} cartas):</span>
                <span class="cart-summary-total-mxn">$${totalMxn.toFixed(2)} MXN</span>
              </div>
              <div class="cart-summary-total-usd">
                Equivalente internacional aproximado: $${totalUsd.toFixed(2)} USD
              </div>
              <div style="display:flex; gap:8px; margin-top:8px;">
                <button type="button" class="cart-back-btn" id="cart-footer-back-btn" style="flex:1; justify-content:center; padding:8px 10px; font-size:0.72rem;">
                  ← Seguir Seleccionando
                </button>
                <button type="button" class="cart-checkout-btn" id="cart-checkout-btn" style="flex:1.4; margin-top:0;">
                  <span>📊</span>
                  <span>Resumen de Inversión</span>
                </button>
              </div>
            </div>
          `}
        </div>
        <div class="tcg-modal-footer">
          <span class="tcg-footer-note">Portafolio informativo local · Cotizaciones convertidas con ExchangeRate-API</span>
        </div>
      </div>
    `;

    const closeBtn = overlay.querySelector('#close-cart-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Navegación con animación suave para volver a la ventana de cartas del Pokémon
    let isNavigating = false;
    const returnToPokemonCards = (pokeTarget, sourceRow = null) => {
      if (isNavigating) return;
      isNavigating = true;

      const target = (pokeTarget || lastPoke).toLowerCase().trim();
      playRetroBeep('open');

      if (sourceRow) {
        sourceRow.classList.add('navigating');
      }

      // Animación suave de salida (fade + scale)
      overlay.classList.add('closing');

      if (searchInput) {
        searchInput.value = target;
      }

      setTimeout(() => {
        overlay.remove();
        document.removeEventListener('keydown', handleEsc);

        // 1. Simular navegación completa de búsqueda para ese Pokémon en la Pokédex
        searchPokemon();
        if (pokedexContainer) {
          pokedexContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // 2. Abrir la ventana de cartas TCG de ese Pokémon con entrada fluida
        abrirModalValorTCG(target);
      }, 180);
    };

    const backHeaderBtn = overlay.querySelector('#cart-back-to-cards-btn');
    if (backHeaderBtn) backHeaderBtn.addEventListener('click', () => returnToPokemonCards(lastPoke));

    const backFooterBtn = overlay.querySelector('#cart-footer-back-btn');
    if (backFooterBtn) backFooterBtn.addEventListener('click', () => returnToPokemonCards(lastPoke));

    const backEmptyBtn = overlay.querySelector('#empty-back-btn');
    if (backEmptyBtn) backEmptyBtn.addEventListener('click', () => returnToPokemonCards(lastPoke));

    // Botones individuales en cada fila para ir a las cartas de ese Pokémon
    overlay.querySelectorAll('.cart-poke-origin-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const origin = btn.getAttribute('data-poke') || lastPoke;
        const row = btn.closest('.cart-item-row');
        returnToPokemonCards(origin, row);
      });
    });

    // Clic en la miniatura de la carta para ir directamente a ese Pokémon
    overlay.querySelectorAll('.cart-item-img').forEach((img) => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = img.closest('.cart-item-row');
        const btn = row ? row.querySelector('.cart-poke-origin-btn') : null;
        const origin = (btn ? btn.getAttribute('data-poke') : null) || lastPoke;
        returnToPokemonCards(origin, row);
      });
    });

    // Vaciar portafolio
    const clearBtn = overlay.querySelector('#clear-cart-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        playRetroBeep('error');
        clearCart();
        renderCartContent();
      });
    }

    // Controles de cantidad (copias en seguimiento)
    overlay.querySelectorAll('.cart-qty-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        playRetroBeep('click');
        const cardId = btn.getAttribute('data-card-id');
        const delta = parseInt(btn.getAttribute('data-qty-change'), 10) || 0;
        updateCartItemQty(cardId, delta);
        renderCartContent();
      });
    });

    // Eliminar fila individual
    overlay.querySelectorAll('.cart-item-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        playRetroBeep('click');
        const cardId = btn.getAttribute('data-delete-card-id');
        removeFromCart(cardId);
        renderCartContent();
      });
    });

    // Resumen de Inversión Informativo
    const checkoutBtn = overlay.querySelector('#cart-checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => {
        playRetroBeep('open');
        const body = overlay.querySelector('#cart-modal-body');
        if (body) {
          body.innerHTML = `
            <div class="tcg-empty-box">
              <span style="font-size:2.4rem;">📊</span>
              <h4 style="font-family:var(--font-retro); font-size:1.05rem; color:#166534;">Resumen Informativo del Portafolio</h4>
              <p style="color:#334155; font-size:0.8rem; max-width:440px; line-height:1.4; margin-top:4px;">
                Tu portafolio cuenta con <strong>${totalItems} cartas en seguimiento</strong> con una valuación total estimada de <strong>$${totalMxn.toFixed(2)} MXN</strong> (≈ $${totalUsd.toFixed(2)} USD).
              </p>
              <div style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:10px 14px; margin-top:10px; font-size:0.72rem; color:#475569; text-align:left; max-width:430px; line-height:1.4;">
                📌 <strong>Nota informativa:</strong> Este estimado es únicamente de referencia para coleccionistas e inversores del TCG. Esta aplicación no procesa pagos ni realiza ventas comerciales.
              </div>
              <div style="display:flex; gap:8px; margin-top:14px;">
                <button type="button" class="cart-back-btn" id="portfolio-view-items-btn" style="padding:6px 14px; font-size:0.72rem;">← Ver Lista de Cartas</button>
                <button type="button" class="cart-checkout-btn" style="width:auto; padding:6px 14px; margin-top:0;" id="continue-shopping-btn">Volver a la Pokédex</button>
              </div>
            </div>
          `;
          const backListBtn = body.querySelector('#portfolio-view-items-btn');
          if (backListBtn) backListBtn.addEventListener('click', () => renderCartContent());
          const contBtn = body.querySelector('#continue-shopping-btn');
          if (contBtn) contBtn.addEventListener('click', closeModal);
        }
      });
    }
  }

  document.addEventListener('keydown', handleEsc);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  renderCartContent();
  document.body.appendChild(overlay);
}

// Alias para mantener compatibilidad con cualquier invocación existente
function abrirModalCarrito() {
  abrirModalPortafolio();
}

// Caché en memoria para cotizaciones y cartas TCG
const tcgPricesCache = {};

// Estado y caché para tipo de cambio en tiempo real (ExchangeRate-API)
let cachedExchangeRates = null;
let lastRateFetchTime = 0;
let currentTcgCurrency = 'MXN'; // 'MXN' por defecto según lo solicitado

/**
 * Consulta la API pública y en tiempo real de ExchangeRate-API (open.er-api.com)
 * para obtener el tipo de cambio oficial de USD a MXN y EUR
 * @returns {Promise<{ usdToMxn: number, eurToUsd: number }>}
 */
async function getExchangeRates() {
  const now = Date.now();
  // Caché de 30 minutos para no saturar la red
  if (cachedExchangeRates && (now - lastRateFetchTime < 1800000)) {
    return cachedExchangeRates;
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && data.rates.MXN) {
        const usdToMxn = data.rates.MXN;
        const eurToUsd = data.rates.EUR ? (1 / data.rates.EUR) : 1.08;
        cachedExchangeRates = { usdToMxn, eurToUsd };
        lastRateFetchTime = now;
        return cachedExchangeRates;
      }
    }
  } catch (e) {
    console.warn('Error al consultar ExchangeRate-API:', e);
  }

  // Fallback de contingencia en caso de fallo de red
  return cachedExchangeRates || { usdToMxn: 18.20, eurToUsd: 1.08 };
}

/**
 * Abre el diálogo modal con las cotizaciones de mercado de las cartas TCG del Pokémon
 * con conversión a Pesos Mexicanos (MXN) en tiempo real mediante ExchangeRate-API
 * @param {string} pokemonName - Nombre de la especie del Pokémon
 */
async function abrirModalValorTCG(pokemonName) {
  playRetroBeep('open');

  // Si ya existe un modal abierto, cerrarlo
  const existingModal = document.getElementById('tcg-modal-overlay');
  if (existingModal) existingModal.remove();

  const cleanName = (pokemonName || '').toLowerCase().trim();
  const capName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
  lastTcgPokemonSearch = cleanName;

  const overlay = document.createElement('div');
  overlay.className = 'tcg-modal-overlay';
  overlay.id = 'tcg-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Valores de cartas de ${capName}`);

  overlay.innerHTML = `
    <div class="tcg-modal-card">
      <div class="tcg-modal-header">
        <div class="tcg-header-title-wrap">
          <span class="tcg-header-kicker">MERCADO POKÉMON TCG</span>
          <h3 class="tcg-modal-title">Cartas y Valores de ${capName}</h3>
        </div>
        <div class="tcg-header-actions">
          <button type="button" class="tcg-header-cart-btn" id="tcg-modal-cart-btn" title="Ver mi Portafolio TCG">
            <span>💼</span>
            <span>Portafolio</span>
            <span class="badge-counter" id="tcg-modal-cart-num">${getCart().reduce((sum, i) => sum + (i.quantity || 1), 0)}</span>
          </button>
          <div class="tcg-rate-pill" id="tcg-rate-pill" title="Tipo de cambio en vivo provisto por ExchangeRate-API">
            <span class="tcg-rate-dot"></span>
            <span id="tcg-rate-text">Cargando cambio...</span>
          </div>
          <div class="tcg-currency-toggle" role="group" aria-label="Moneda">
            <button type="button" class="tcg-curr-btn ${currentTcgCurrency === 'MXN' ? 'active' : ''}" data-curr="MXN" title="Ver en Pesos Mexicanos">MXN $</button>
            <button type="button" class="tcg-curr-btn ${currentTcgCurrency === 'USD' ? 'active' : ''}" data-curr="USD" title="Ver en Dólares Estadounidenses">USD $</button>
          </div>
          <button type="button" class="tcg-close-btn" id="tcg-close-btn" aria-label="Cerrar modal">✕</button>
        </div>
      </div>
      <div class="tcg-modal-body" id="tcg-modal-body">
        <div class="tcg-loading-box">
          <div class="tcg-spinner"></div>
          <p>Consultando cotizaciones de mercado y tipo de cambio en vivo...</p>
        </div>
      </div>
      <div class="tcg-modal-footer">
        <span class="tcg-footer-note">Precios TCGplayer/Cardmarket convertidos a Pesos Mexicanos vía ExchangeRate-API</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let isClosing = false;
  const closeModal = () => {
    if (isClosing) return;
    isClosing = true;
    overlay.classList.add('closing');
    document.removeEventListener('keydown', handleEsc);
    setTimeout(() => {
      overlay.remove();
    }, 180);
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeModal();
  };

  document.addEventListener('keydown', handleEsc);

  const closeBtn = overlay.querySelector('#tcg-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const modalBody = overlay.querySelector('#tcg-modal-body');
  const rateTextEl = overlay.querySelector('#tcg-rate-text');
  let cardsWithPrices = null;
  let rates = { usdToMxn: 18.20, eurToUsd: 1.08 };

  // Función para re-renderizar las cartas según la moneda activa (MXN o USD)
  function renderCardsGrid() {
    if (!modalBody || !cardsWithPrices) return;

    if (rateTextEl) {
      rateTextEl.textContent = `1 USD ≈ $${rates.usdToMxn.toFixed(2)} MXN`;
    }

    modalBody.innerHTML = `
      <div class="tcg-cards-grid">
        ${cardsWithPrices.map((card) => {
          const setName = card.set?.name || 'Colección Pokémon';
          const rarity = card.rarity || 'Común';
          const imgUrl = card.image ? `${card.image}/high.webp` : '';
          const fallbackImg = card.image ? `${card.image}/high.png` : '';

          // Extraer precios de TCGplayer o Cardmarket
          const tcgPricing = card.pricing?.tcgplayer;
          const cmPricing = card.pricing?.cardmarket;

          const priceObj = tcgPricing ? (
            tcgPricing.normal ||
            tcgPricing.holofoil ||
            tcgPricing['reverse-holofoil'] ||
            tcgPricing['1st-edition-holofoil'] ||
            tcgPricing.unlimited ||
            (typeof tcgPricing === 'object' ? Object.values(tcgPricing)[0] : null)
          ) : null;

          let primaryPrice = 'Sin cotización';
          let secondaryPrice = '';
          let rangeText = '';

          let cardUsdVal = 0;
          let cardMxnVal = 0;

          if (priceObj && priceObj.marketPrice !== null && priceObj.marketPrice !== undefined) {
            cardUsdVal = Number(priceObj.marketPrice);
            cardMxnVal = cardUsdVal * rates.usdToMxn;

            if (currentTcgCurrency === 'MXN') {
              primaryPrice = `$${cardMxnVal.toFixed(2)} MXN`;
              secondaryPrice = `≈ $${cardUsdVal.toFixed(2)} USD`;
              if (priceObj.lowPrice && priceObj.highPrice) {
                rangeText = `Rango: $${(Number(priceObj.lowPrice) * rates.usdToMxn).toFixed(2)} - $${(Number(priceObj.highPrice) * rates.usdToMxn).toFixed(2)} MXN`;
              }
            } else {
              primaryPrice = `$${cardUsdVal.toFixed(2)} USD`;
              secondaryPrice = `≈ $${cardMxnVal.toFixed(2)} MXN`;
              if (priceObj.lowPrice && priceObj.highPrice) {
                rangeText = `Rango: $${Number(priceObj.lowPrice).toFixed(2)} - $${Number(priceObj.highPrice).toFixed(2)} USD`;
              }
            }
          } else if (cmPricing && (cmPricing.avg !== null && cmPricing.avg !== undefined || cmPricing.trend)) {
            const eurVal = Number(cmPricing.avg || cmPricing.trend);
            cardUsdVal = eurVal * rates.eurToUsd;
            cardMxnVal = cardUsdVal * rates.usdToMxn;

            if (currentTcgCurrency === 'MXN') {
              primaryPrice = `$${cardMxnVal.toFixed(2)} MXN`;
              secondaryPrice = `≈ €${eurVal.toFixed(2)} EUR`;
              if (cmPricing.low) {
                rangeText = `Mín: $${(Number(cmPricing.low) * rates.eurToUsd * rates.usdToMxn).toFixed(2)} MXN`;
              }
            } else {
              primaryPrice = `$${cardUsdVal.toFixed(2)} USD`;
              secondaryPrice = `≈ €${eurVal.toFixed(2)} EUR`;
              if (cmPricing.low) {
                rangeText = `Mín: €${Number(cmPricing.low).toFixed(2)} EUR`;
              }
            }
          }

          const safeCardName = String(card.name || '').replace(/"/g, '&quot;');
          const safeCardSet = String(setName).replace(/"/g, '&quot;');
          const safeCardRarity = String(rarity).replace(/"/g, '&quot;');
          const safeCardImg = String(imgUrl || fallbackImg).replace(/"/g, '&quot;');

          return `
            <div class="tcg-card-item">
              <div class="tcg-card-img-wrap">
                <img
                  class="tcg-card-img"
                  src="${imgUrl}"
                  alt="${safeCardName}"
                  loading="lazy"
                  onerror="this.onerror=null; this.src='${fallbackImg}';"
                />
              </div>
              <div class="tcg-card-meta">
                <span class="tcg-card-name" title="${safeCardName}">${card.name}</span>
                <span class="tcg-card-set" title="${safeCardSet}">${setName} · ${rarity}</span>
              </div>
              <div class="tcg-price-tag-wrap">
                <span class="tcg-market-price">${primaryPrice}</span>
                ${secondaryPrice ? `<span class="tcg-price-sub">${secondaryPrice}</span>` : ''}
                ${rangeText ? `<span class="tcg-price-sub" style="opacity:0.85;">${rangeText}</span>` : ''}
              </div>
              <button
                type="button"
                class="tcg-add-cart-btn"
                data-card-id="${card.id}"
                data-card-name="${safeCardName}"
                data-card-set="${safeCardSet}"
                data-card-rarity="${safeCardRarity}"
                data-card-img="${safeCardImg}"
                data-card-price-usd="${cardUsdVal}"
                data-card-price-mxn="${cardMxnVal}"
                title="Agregar esta carta a tu Portafolio TCG de inversión"
              >
                <span>💼</span>
                <span class="add-btn-txt">+ Portafolio</span>
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Manejar clics en el botón de agregar al portafolio
    modalBody.querySelectorAll('.tcg-add-cart-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardId = btn.getAttribute('data-card-id');
        const cardName = btn.getAttribute('data-card-name');
        const cardSet = btn.getAttribute('data-card-set');
        const cardRarity = btn.getAttribute('data-card-rarity');
        const cardImg = btn.getAttribute('data-card-img');
        const priceUsd = parseFloat(btn.getAttribute('data-card-price-usd')) || 0;
        const priceMxn = parseFloat(btn.getAttribute('data-card-price-mxn')) || 0;

        addToCart({
          id: cardId,
          name: cardName,
          setName: cardSet,
          rarity: cardRarity,
          image: cardImg,
          priceUsd,
          priceMxn,
          pokemonOrigin: cleanName
        });

        playRetroBeep('open');

        const txtSpan = btn.querySelector('.add-btn-txt');
        btn.classList.add('added-success');
        if (txtSpan) txtSpan.textContent = '✓ ¡En Portafolio!';
        setTimeout(() => {
          btn.classList.remove('added-success');
          if (txtSpan) txtSpan.textContent = '+ Portafolio';
        }, 1200);
      });
    });
  }

  // Botón del carrito dentro del modal TCG con transición fluida
  const modalCartBtn = overlay.querySelector('#tcg-modal-cart-btn');
  if (modalCartBtn) {
    modalCartBtn.addEventListener('click', () => {
      overlay.classList.add('closing');
      setTimeout(() => {
        overlay.remove();
        document.removeEventListener('keydown', handleEsc);
        abrirModalCarrito();
      }, 160);
    });
  }

  // Manejar el alternador de moneda MXN / USD
  const currBtns = overlay.querySelectorAll('.tcg-curr-btn');
  currBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const selectedCurr = btn.getAttribute('data-curr');
      if (selectedCurr && selectedCurr !== currentTcgCurrency) {
        playRetroBeep('click');
        currentTcgCurrency = selectedCurr;
        currBtns.forEach((b) => b.classList.toggle('active', b === btn));
        renderCardsGrid();
      }
    });
  });

  try {
    // Cargar en paralelo el tipo de cambio de ExchangeRate-API y las cartas de TCGdex
    const [fetchedRates, cachedOrFetchedCards] = await Promise.all([
      getExchangeRates(),
      (async () => {
        if (tcgPricesCache[cleanName]) return tcgPricesCache[cleanName];

        let searchName = cleanName.replace(/-/g, ' ').trim();
        let searchRes = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(searchName)}`);
        let allCards = [];
        if (searchRes.ok) {
          try {
            allCards = await searchRes.json();
          } catch (e) {}
        }

        // Si no encontró cartas y el nombre tenía guion (ej. aegislash-shield, deoxys-normal), reintentar con el nombre base
        if ((!Array.isArray(allCards) || allCards.length === 0) && cleanName.includes('-')) {
          const baseName = cleanName.split('-')[0].trim();
          const baseRes = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(baseName)}`);
          if (baseRes.ok) {
            try {
              allCards = await baseRes.json();
            } catch (e) {}
          }
        }

        const validCards = (Array.isArray(allCards) ? allCards : []).filter((c) => c && c.image).slice(0, 6);

        if (validCards.length === 0) return [];

        const detailedCards = await Promise.all(
          validCards.map(async (c) => {
            try {
              const detailRes = await fetch(`https://api.tcgdex.net/v2/en/cards/${c.id}`);
              if (detailRes.ok) {
                return await detailRes.json();
              }
            } catch (e) {}
            return c;
          })
        );

        tcgPricesCache[cleanName] = detailedCards;
        return detailedCards;
      })()
    ]);

    rates = fetchedRates;
    cardsWithPrices = cachedOrFetchedCards;

    if (cardsWithPrices.length === 0) {
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="tcg-empty-box">
            <span style="font-size:1.8rem;">🃏</span>
            <p>No se encontraron cartas registradas para <strong>${capName}</strong>.</p>
          </div>
        `;
      }
      return;
    }

    renderCardsGrid();
  } catch (err) {
    console.error('Error al consultar mercado TCG / ExchangeRate:', err);
    if (modalBody) {
      modalBody.innerHTML = `
        <div class="tcg-empty-box">
          <span style="font-size:1.8rem;">⚠️</span>
          <p>No se pudo conectar con el mercado TCG o ExchangeRate-API en este momento. Inténtalo nuevamente.</p>
        </div>
      `;
    }
  }
}

/**
 * Despliega un overlay tipo burbuja sobre la imagen con las evoluciones anteriores y posteriores
 * @param {Object} data - Datos del Pokémon actual
 * @param {{ previous: Array, posterior: Array }} evolutionData - Evoluciones calculadas
 */
function mostrarBurbujasEvolucion(data, evolutionData) {
  const spriteStage = document.getElementById('sprite-stage');
  if (!spriteStage) return;

  // Si ya está abierto, alternar cerrándolo
  const existingOverlay = spriteStage.querySelector('.evolution-bubbles-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
    return;
  }

  const hasPrev = evolutionData.previous && evolutionData.previous.length > 0;
  const hasPost = evolutionData.posterior && evolutionData.posterior.length > 0;
  const hasBranches = evolutionData.branches && evolutionData.branches.length > 0;

  const overlay = document.createElement('div');
  overlay.className = 'evolution-bubbles-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Burbujas de evolución');

  let contentHtml = '';

  if (!hasPrev && !hasPost && !hasBranches) {
    contentHtml = `
      <div class="bubbles-header">
        <span class="bubbles-title">🫧 Línea Evolutiva</span>
        <button type="button" class="bubbles-close-btn" id="bubbles-close-btn" aria-label="Cerrar burbujas">✕</button>
      </div>
      <p class="bubble-empty-msg">Este Pokémon no cuenta con evoluciones.</p>
    `;
  } else {
    const nodes = [];

    // 1. Burbujas de evoluciones anteriores
    (evolutionData.previous || []).forEach((poke) => {
      const cap = poke.label || (poke.name.charAt(0).toUpperCase() + poke.name.slice(1));
      nodes.push(`
        <button type="button" class="bubble-node" data-pokemon="${poke.id || poke.name}" title="Ir a ${cap}">
          <span class="bubble-role-tag bubble-role-prev">Ant</span>
          <div class="bubble-circle">
            <img class="bubble-thumb" src="${poke.sprite}" alt="${cap}" loading="lazy" />
          </div>
          <span class="bubble-label">${cap}</span>
        </button>
      `);
    });

    // 2. Burbuja del Pokémon actual
    const currentCap = (data.name || '').charAt(0).toUpperCase() + (data.name || '').slice(1);
    const currentThumb = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`;
    nodes.push(`
      <div class="bubble-node is-current" title="Pokémon actual">
        <span class="bubble-role-tag bubble-role-curr">Actual</span>
        <div class="bubble-circle is-current">
          <img class="bubble-thumb" src="${currentThumb}" alt="${currentCap}" loading="lazy" />
        </div>
        <span class="bubble-label">${currentCap}</span>
      </div>
    `);

    // 3. Burbujas de evoluciones posteriores
    (evolutionData.posterior || []).forEach((poke) => {
      const cap = poke.label || (poke.name.charAt(0).toUpperCase() + poke.name.slice(1));
      nodes.push(`
        <button type="button" class="bubble-node" data-pokemon="${poke.id || poke.name}" title="Ir a ${cap}">
          <span class="bubble-role-tag bubble-role-next">Post</span>
          <div class="bubble-circle">
            <img class="bubble-thumb" src="${poke.sprite}" alt="${cap}" loading="lazy" />
          </div>
          <span class="bubble-label">${cap}</span>
        </button>
      `);
    });

    // 4. Burbujas de ramificaciones alternativas (ej. Vileplume cuando se consulta Bellossom)
    (evolutionData.branches || []).forEach((poke) => {
      const cap = poke.label || (poke.name.charAt(0).toUpperCase() + poke.name.slice(1));
      nodes.push(`
        <button type="button" class="bubble-node" data-pokemon="${poke.id || poke.name}" title="Ir a ${cap} (Alterna)">
          <span class="bubble-role-tag bubble-role-branch">Alterna</span>
          <div class="bubble-circle">
            <img class="bubble-thumb" src="${poke.sprite}" alt="${cap}" loading="lazy" />
          </div>
          <span class="bubble-label">${cap}</span>
        </button>
      `);
    });

    contentHtml = `
      <div class="bubbles-header">
        <span class="bubbles-title">🫧 Toca una evolución</span>
        <button type="button" class="bubbles-close-btn" id="bubbles-close-btn" aria-label="Cerrar burbujas">✕</button>
      </div>
      <div class="bubbles-track">
        ${nodes.join('<span class="bubble-arrow" aria-hidden="true">›</span>')}
      </div>
    `;
  }

  overlay.innerHTML = contentHtml;
  spriteStage.appendChild(overlay);

  // Cerrar al pulsar la cruz
  const closeBtn = overlay.querySelector('#bubbles-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
    });
  }

  // Navegar al hacer clic en cualquier burbuja
  const bubbleBtns = overlay.querySelectorAll('.bubble-node[data-pokemon]');
  bubbleBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetPokemon = btn.getAttribute('data-pokemon');
      if (targetPokemon && searchInput) {
        searchInput.value = targetPokemon;
        overlay.remove();
        searchPokemon();
        if (pokedexContainer) {
          pokedexContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  });
}

/**
 * Construye la sección HTML de evoluciones anteriores, posteriores y ramas alternativas en un solo riel continuo
 * @param {Object} data - Datos del Pokémon actual
 * @param {{ previous: Array, posterior: Array, branches: Array }} evolutionData - Evoluciones calculadas
 * @returns {string} Fragmento HTML
 */
function buildEvolutionsHtml(data, evolutionData) {
  const hasPrevious = evolutionData.previous && evolutionData.previous.length > 0;
  const hasPosterior = evolutionData.posterior && evolutionData.posterior.length > 0;
  const hasBranches = evolutionData.branches && evolutionData.branches.length > 0;

  if (!hasPrevious && !hasPosterior && !hasBranches) {
    return `
      <section class="evolutions-section" aria-label="Línea Evolutiva">
        <div class="evolutions-header">
          <h3 class="evolutions-title">Línea Evolutiva</h3>
          <span class="evolutions-subtitle">Sin evoluciones</span>
        </div>
        <p class="no-evolutions-text">Este Pokémon no cuenta con evoluciones registradas.</p>
      </section>
    `;
  }

  const arrowHtml = `
    <span class="rail-arrow" aria-hidden="true" title="Evoluciona a">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </span>
  `;

  // Miniaturas de evoluciones anteriores
  const previousCards = (evolutionData.previous || []).map((poke) => {
    const capName = poke.label || (poke.name.charAt(0).toUpperCase() + poke.name.slice(1));
    const formattedId = `#${String(poke.id).padStart(3, '0')}`;
    return `
      <button type="button" class="evo-card-btn" data-pokemon="${poke.id || poke.name}" aria-label="Ver evolución anterior ${capName}">
        <span class="evo-badge evo-badge-prev">Anterior</span>
        <img class="evo-thumb" src="${poke.sprite}" alt="${capName}" loading="lazy" onerror="this.style.opacity='0.4'" />
        <span class="evo-name">${capName}</span>
        <span class="evo-id">${formattedId}</span>
      </button>
    `;
  });

  // Miniatura del Pokémon actual en el riel
  const currentCapName = (data.name || '').charAt(0).toUpperCase() + (data.name || '').slice(1);
  const currentThumb = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`;
  const currentCard = `
    <div class="evo-card-btn is-current" aria-current="true" title="Pokémon actual">
      <span class="evo-badge evo-badge-curr">Actual</span>
      <img class="evo-thumb" src="${currentThumb}" alt="${currentCapName}" loading="lazy" />
      <span class="evo-name">${currentCapName}</span>
      <span class="evo-id">#${String(data.id).padStart(3, '0')}</span>
    </div>
  `;

  // Miniaturas de evoluciones posteriores
  const posteriorCards = (evolutionData.posterior || []).map((poke) => {
    const capName = poke.label || (poke.name.charAt(0).toUpperCase() + poke.name.slice(1));
    const formattedId = `#${String(poke.id).padStart(3, '0')}`;
    return `
      <button type="button" class="evo-card-btn" data-pokemon="${poke.id || poke.name}" aria-label="Ver evolución posterior ${capName}">
        <span class="evo-badge evo-badge-next">Posterior</span>
        <img class="evo-thumb" src="${poke.sprite}" alt="${capName}" loading="lazy" onerror="this.style.opacity='0.4'" />
        <span class="evo-name">${capName}</span>
        <span class="evo-id">${formattedId}</span>
      </button>
    `;
  });

  // Miniaturas de ramificaciones alternativas (ej. Vileplume cuando el actual es Bellossom)
  const branchCards = (evolutionData.branches || []).map((poke) => {
    const capName = poke.label || (poke.name.charAt(0).toUpperCase() + poke.name.slice(1));
    const formattedId = `#${String(poke.id).padStart(3, '0')}`;
    return `
      <button type="button" class="evo-card-btn" data-pokemon="${poke.id || poke.name}" aria-label="Ver evolución alternativa ${capName}">
        <span class="evo-badge evo-badge-branch">Alterna</span>
        <img class="evo-thumb" src="${poke.sprite}" alt="${capName}" loading="lazy" onerror="this.style.opacity='0.4'" />
        <span class="evo-name">${capName}</span>
        <span class="evo-id">${formattedId}</span>
      </button>
    `;
  });

  // Ensamblar todo en un solo riel continuo
  const railElements = [];

  if (previousCards.length > 0) {
    previousCards.forEach((card, idx) => {
      if (idx > 0) railElements.push(arrowHtml);
      railElements.push(card);
    });
    railElements.push(arrowHtml);
  }

  railElements.push(currentCard);

  if (posteriorCards.length > 0) {
    railElements.push(arrowHtml);
    posteriorCards.forEach((card, idx) => {
      if (idx > 0) railElements.push(arrowHtml);
      railElements.push(card);
    });
  }

  if (branchCards.length > 0) {
    railElements.push(arrowHtml);
    branchCards.forEach((card, idx) => {
      if (idx > 0) railElements.push(arrowHtml);
      railElements.push(card);
    });
  }

  const totalFamilyCount = previousCards.length + 1 + posteriorCards.length + branchCards.length;

  return `
    <section class="evolutions-section" aria-label="Línea Evolutiva en Riel">
      <div class="evolutions-header">
        <h3 class="evolutions-title">Línea Evolutiva</h3>
        <span class="evolutions-subtitle">${totalFamilyCount} en la familia</span>
      </div>
      <div class="evolution-rail-wrapper">
        <div class="evolution-rail" role="region" aria-label="Riel de evoluciones">
          ${railElements.join('')}
        </div>
      </div>
    </section>
  `;
}

/**
 * Limpia el contenedor y muestra el mensaje de error en rojo
 */
function mostrarError() {
  playRetroBeep('error');
  if (!pokedexContainer) return;
  pokedexContainer.innerHTML = `
    <div class="error-msg">
      <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>Pokémon no encontrado</span>
    </div>
  `;
}

/* ==========================================================================
   1. Filtro por Tipo Elemental (Primer Filtro con 'Todos')
   ========================================================================== */

/**
 * Inicializa los botones de filtro por tipo en la barra superior del diccionario
 */
function initTypeChips() {
  if (!typeChipsRail) return;
  typeChipsRail.innerHTML = '';

  POKEMON_TYPES.forEach((typeObj) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `type-filter-btn ${typeObj.id === currentSelectedType ? 'active' : ''}`;
    btn.setAttribute('data-type', typeObj.id);
    btn.textContent = typeObj.name;
    btn.setAttribute('aria-pressed', typeObj.id === currentSelectedType ? 'true' : 'false');
    btn.setAttribute('aria-label', `Filtrar por tipo ${typeObj.name}`);

    btn.addEventListener('click', () => {
      selectTypeFilter(typeObj.id);
    });

    typeChipsRail.appendChild(btn);
  });
}

/**
 * Selecciona un tipo elemental y actualiza posteriormente las letras disponibles
 * @param {string} typeId - Identificador del tipo o 'all'
 */
async function selectTypeFilter(typeId) {
  playRetroBeep('click');
  if (currentSelectedType === typeId) return;

  currentSelectedType = typeId;

  if (typeChipsRail) {
    const buttons = typeChipsRail.querySelectorAll('.type-filter-btn');
    buttons.forEach((btn) => {
      const match = btn.getAttribute('data-type') === typeId;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  const typeObj = POKEMON_TYPES.find((t) => t.id === typeId);
  const typeLabel = typeObj ? typeObj.name : typeId;
  if (activeTypeName) {
    activeTypeName.textContent = typeLabel;
  }

  const pokemonListForType = await getPokemonForType(typeId);
  updateDictionaryForList(pokemonListForType, typeLabel);
}

/**
 * Retorna la lista de Pokémon que pertenecen al tipo seleccionado (con caché)
 * @param {string} typeId
 * @returns {Promise<Array<{ name: string, id: number, sprite: string }>>}
 */
async function getPokemonForType(typeId) {
  if (typeId === 'all') {
    return allPokemonList;
  }

  if (typePokemonCache[typeId]) {
    return typePokemonCache[typeId];
  }

  try {
    if (dictionaryStatus) {
      dictionaryStatus.textContent = `Cargando tipo...`;
    }

    const res = await fetch(`https://pokeapi.co/api/v2/type/${typeId}`);
    if (!res.ok) throw new Error('Error al cargar tipo');

    const data = await res.json();
    const list = (data.pokemon || []).map((entry) => {
      const p = entry.pokemon;
      const parts = p.url.split('/').filter(Boolean);
      const id = parseInt(parts[parts.length - 1], 10);
      return {
        name: p.name,
        id,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`
      };
    });

    list.sort((a, b) => a.name.localeCompare(b.name));
    typePokemonCache[typeId] = list;
    return list;
  } catch (err) {
    console.warn(`Error al consultar tipo ${typeId}:`, err);
    return [];
  }
}

/**
 * Re-indexa el diccionario según la lista filtrada por tipo y actualiza las letras A-Z
 * @param {Array<{ name: string, id: number, sprite: string }>} list
 * @param {string} typeLabel
 */
function updateDictionaryForList(list, typeLabel) {
  alphabetLetters.forEach((letter) => {
    pokemonDictionary[letter] = [];
  });

  list.forEach((poke) => {
    const firstChar = poke.name.charAt(0).toUpperCase();
    if (pokemonDictionary[firstChar]) {
      pokemonDictionary[firstChar].push(poke);
    }
  });

  alphabetLetters.forEach((letter) => {
    const btn = document.getElementById(`letter-btn-${letter}`);
    const count = pokemonDictionary[letter].length;
    if (btn) {
      btn.disabled = count === 0;
      btn.title = count > 0 ? `${count} Pokémon (${typeLabel})` : `Sin Pokémon de tipo ${typeLabel}`;
    }
  });

  if (dictionaryStatus) {
    if (currentSelectedType === 'all') {
      dictionaryStatus.textContent = `${list.length} Pokémon indexados`;
    } else {
      dictionaryStatus.textContent = `${list.length} Pokémon (${typeLabel})`;
    }
  }

  if (currentActiveLetter) {
    if (pokemonDictionary[currentActiveLetter].length > 0) {
      renderLetterResults(currentActiveLetter, typeLabel);
    } else {
      cerrarResultadosLetra();
    }
  }
}

/* ==========================================================================
   2. Lógica del Diccionario Alfabético (Búsqueda por Primera Letra)
   ========================================================================== */

/**
 * Genera los botones de letras A-Z en la interfaz
 */
function initAlphabetGrid() {
  if (!alphabetGrid) return;
  alphabetGrid.innerHTML = '';

  alphabetLetters.forEach((letter) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'letter-btn';
    btn.id = `letter-btn-${letter}`;
    btn.textContent = letter;
    btn.setAttribute('aria-label', `Filtrar por letra ${letter}`);

    btn.addEventListener('click', () => {
      selectLetter(letter);
    });

    alphabetGrid.appendChild(btn);
  });
}

/**
 * Carga e indexa todos los Pokémon en segundo plano al iniciar
 */
async function loadAndIndexPokemon() {
  try {
    const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0');
    if (!res.ok) throw new Error('No se pudo cargar el listado');

    const data = await res.json();
    const allResults = data.results || [];

    allPokemonList = allResults.map((item) => {
      const parts = item.url.split('/').filter(Boolean);
      const id = parseInt(parts[parts.length - 1], 10);
      return {
        name: item.name,
        id,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`
      };
    });

    allPokemonList.sort((a, b) => a.name.localeCompare(b.name));
    updateDictionaryForList(allPokemonList, 'Todos');
  } catch (err) {
    if (dictionaryStatus) {
      dictionaryStatus.textContent = 'Índice offline';
    }
  }
}

/**
 * Muestra la lista de Pokémon que comienzan con la letra seleccionada
 * @param {string} letter - Letra del abecedario seleccionada
 */
function selectLetter(letter) {
  playRetroBeep('click');
  if (currentActiveLetter === letter && letterResults && !letterResults.hidden) {
    cerrarResultadosLetra();
    return;
  }

  currentActiveLetter = letter;

  alphabetLetters.forEach((l) => {
    const btn = document.getElementById(`letter-btn-${l}`);
    if (btn) {
      if (l === letter) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    }
  });

  const typeObj = POKEMON_TYPES.find((t) => t.id === currentSelectedType);
  const typeLabel = typeObj ? typeObj.name : '';
  renderLetterResults(letter, typeLabel);
}

/**
 * Renderiza los resultados de la letra seleccionada
 * @param {string} letter
 * @param {string} typeLabel
 */
function renderLetterResults(letter, typeLabel = '') {
  const list = pokemonDictionary[letter] || [];

  if (activeLetterBadge) {
    activeLetterBadge.textContent = letter;
  }

  if (letterCount) {
    const suffix = currentSelectedType !== 'all' ? ` (Tipo ${typeLabel})` : '';
    letterCount.textContent = `${list.length} Pokémon encontrados${suffix}`;
  }

  if (letterPokemonList) {
    letterPokemonList.innerHTML = '';

    if (list.length === 0) {
      letterPokemonList.innerHTML = `<p style="grid-column: 1 / -1; padding: 12px; font-size: 0.85rem; color: #64748b; text-align: center;">No hay Pokémon de tipo ${typeLabel} registrados con la letra ${letter}.</p>`;
    } else {
      list.forEach((poke) => {
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = 'pokemon-item-btn';
        itemBtn.setAttribute('aria-label', `Ver detalles de ${poke.name}`);

        const capitalized = poke.name.charAt(0).toUpperCase() + poke.name.slice(1);
        const formattedId = `#${String(poke.id).padStart(3, '0')}`;

        itemBtn.innerHTML = `
          <img class="item-thumb" src="${poke.sprite}" alt="${capitalized}" loading="lazy" onerror="this.style.display='none'">
          <div class="item-info">
            <span class="item-name">${capitalized}</span>
            <span class="item-id">${formattedId}</span>
          </div>
        `;

        itemBtn.addEventListener('click', () => {
          if (searchInput) {
            searchInput.value = poke.name;
          }
          searchPokemon();
          if (pokedexContainer) {
            pokedexContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });

        letterPokemonList.appendChild(itemBtn);
      });
    }
  }

  if (letterResults) {
    letterResults.hidden = false;
  }
}

/**
 * Cierra el panel de resultados de la letra
 */
function cerrarResultadosLetra() {
  if (letterResults) {
    letterResults.hidden = true;
  }
  currentActiveLetter = null;
  alphabetLetters.forEach((l) => {
    const btn = document.getElementById(`letter-btn-${l}`);
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
}

// Botón de cerrar panel de resultados alfabéticos
if (closeResultsBtn) {
  closeResultsBtn.addEventListener('click', cerrarResultadosLetra);
}

// Añadir evento de clic al botón de búsqueda
if (searchBtn) {
  searchBtn.addEventListener('click', searchPokemon);
}

// Soporte para tecla Enter en el campo de texto
if (searchInput) {
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchPokemon();
    }
  });
}

// Sintetizador Web Audio API para efectos táctiles retro
let audioFxEnabled = true;
let audioCtx = null;

/**
 * Emite un breve pitido retro analógico para feedback táctil
 * @param {'click' | 'open' | 'error'} type
 */
function playRetroBeep(type = 'click') {
  if (!audioFxEnabled) return;
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'click') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(350, now + 0.035);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      osc.start(now);
      osc.stop(now + 0.035);
    } else if (type === 'open') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.04);
      osc.frequency.setValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch (e) {
    // Silencio ante restricciones de navegador
  }
}

// Botón de alternar efectos de sonido retro
const audioFxToggle = document.getElementById('audio-fx-toggle');
if (audioFxToggle) {
  audioFxToggle.addEventListener('click', () => {
    audioFxEnabled = !audioFxEnabled;
    audioFxToggle.classList.toggle('active', audioFxEnabled);
    if (audioFxEnabled) {
      playRetroBeep('open');
    }
  });
}

// Inicialización de la aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
  initTypeChips();
  initAlphabetGrid();
  loadAndIndexPokemon();

  // Botones de la barra superior para Colección y Carrito
  const openColBtn = document.getElementById('open-collection-btn');
  if (openColBtn) {
    openColBtn.addEventListener('click', abrirModalColeccion);
  }

  const openCartBtn = document.getElementById('open-cart-btn');
  if (openCartBtn) {
    openCartBtn.addEventListener('click', abrirModalCarrito);
  }

  // Inicializar contadores visuales desde localStorage
  updateCollectionBadges();
  updateCartBadges();

  if (searchInput) {
    searchInput.value = 'pikachu';
    searchPokemon();
  }
});
