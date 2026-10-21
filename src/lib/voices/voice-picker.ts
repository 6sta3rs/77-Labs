import type { Voice } from '../data';

export const voiceCategories = ['Konwersacja', 'Narracja', 'Edukacja', 'Reklama', 'Podcast', 'Audiobook'];
export type VoiceFilters = { query:string; language:string; categories:string[]; kind:string; gender:string; ageGroup:string; library:boolean };
export const emptyVoiceFilters = ():VoiceFilters => ({query:'',language:'all',categories:[],kind:'all',gender:'all',ageGroup:'all',library:false});
export const voiceSearchText = (text:string) => text.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('ł','l');
const languageNames:Record<string,string[]> = {
  pl:['Polski','Polish'],en:['Angielski','English'],de:['Niemiecki','German','Deutsch'],fr:['Francuski','French'],es:['Hiszpański','Spanish'],it:['Włoski','Italian'],pt:['Portugalski','Portuguese'],zh:['Chiński','Chinese','Mandarin'],ja:['Japoński','Japanese'],ko:['Koreański','Korean'],ru:['Rosyjski','Russian'],uk:['Ukraiński','Ukrainian'],ar:['Arabski','Arabic'],hi:['Hindi'],nl:['Niderlandzki','Dutch'],tr:['Turecki','Turkish'],sv:['Szwedzki','Swedish'],da:['Duński','Danish'],no:['Norweski','Norwegian'],fi:['Fiński','Finnish'],cs:['Czeski','Czech'],sk:['Słowacki','Slovak'],hu:['Węgierski','Hungarian'],ro:['Rumuński','Romanian'],bg:['Bułgarski','Bulgarian'],el:['Grecki','Greek'],he:['Hebrajski','Hebrew'],id:['Indonezyjski','Indonesian'],ms:['Malajski','Malay'],vi:['Wietnamski','Vietnamese'],th:['Tajski','Thai'],ta:['Tamilski','Tamil'],te:['Telugu'],bn:['Bengalski','Bengali'],ur:['Urdu'],sw:['Suahili','Swahili'],af:['Afrikaans'],hr:['Chorwacki','Croatian'],sr:['Serbski','Serbian'],sl:['Słoweński','Slovenian'],lt:['Litewski','Lithuanian'],lv:['Łotewski','Latvian'],et:['Estoński','Estonian'],ca:['Kataloński','Catalan'],cy:['Walijski','Welsh'],eu:['Baskijski','Basque'],gl:['Galicyjski','Galician'],fil:['Filipiński','Filipino','Tagalog'],is:['Islandzki','Icelandic'],mk:['Macedoński','Macedonian'],fa:['Perski','Persian'],ne:['Nepalski','Nepali'],si:['Syngaleski','Sinhala'],ml:['Malajalam','Malayalam'],mr:['Marathi'],gu:['Gudźarati','Gujarati'],kn:['Kannada'],pa:['Pendżabski','Punjabi'],as:['Asamski','Assamese'],az:['Azerski','Azerbaijani'],kk:['Kazachski','Kazakh'],uz:['Uzbecki','Uzbek']
};
// Pinned metadata from scripts/runtime/vendor/engine.zip, omnivoice/utils/lang_map.py.
// The engine includes real languages absent from the browser's CLDR display names.
const engineLanguages:Record<string,string> = {
  "abadi":"kbt","abkhazian":"ab","abron":"abr","abua":"abn","adamawa fulfulde":"fub",
  "adyghe":"ady","afade":"aal","afrikaans":"af","agwagwune":"yay","aja (benin)":"ajg",
  "akebu":"keu","alago":"ala","albanian":"sq","algerian arabic":"arq","algerian saharan arabic":"aao",
  "ambo-pasco quechua":"qva","ambonese malay":"abs","amdo tibetan":"adx","amharic":"am","anaang":"anw",
  "angika":"anp","antankarana malagasy":"xmv","aragonese":"an","arbëreshë albanian":"aae","arequipa-la unión quechua":"qxu",
  "armenian":"hy","ashe":"ahs","ashéninka perené":"prq","askopan":"eiv","assamese":"as",
  "asturian":"ast","atayal":"tay","awak":"awo","ayacucho quechua":"quy","azerbaijani":"az",
  "baatonum":"bba","bacama":"bcy","bade":"bde","bafia":"ksf","bafut":"bfd",
  "bagirmi fulfulde":"fui","bago-kusuntu":"bqg","baharna arabic":"abv","bakoko":"bkh","balanta-ganja":"bjt",
  "balti":"bft","bamenyam":"bce","bamun":"bax","bangwinji":"bsj","banjar":"bjn",
  "bankon":"abb","baoulé":"bci","bara malagasy":"bhr","barok":"bjk","basa (cameroon)":"bas",
  "basa (nigeria)":"bzw","bashkir":"ba","basque":"eu","batak mandailing":"btm","batanga":"bnm",
  "bateri":"btv","bats":"bbl","bayot":"bda","bebele":"beb","belarusian":"be",
  "bengali":"bn","betawi":"bew","bhili":"bhb","bhojpuri":"bho","bilur":"bxf",
  "bima":"bhp","bodo":"brx","boghom":"bux","bokyi":"bky","bomu":"bmq",
  "bondei":"bou","borgu fulfulde":"fue","bosnian":"bs","brahui":"brh","braj":"bra",
  "breton":"br","buduma":"bdm","buginese":"bug","bukharic":"bhh","bulgarian":"bg",
  "bulu (cameroon)":"bum","bundeli":"bns","bunun":"bnn","bura-pabir":"bwr","burak":"bys",
  "burmese":"my","burushaski":"bsk","cacaloxtepec mixtec":"miu","cajatambo north lima quechua":"qvl","cakfem-mushere":"cky",
  "cameroon pidgin":"wes","campidanese sardinian":"sro","cantonese":"yue","catalan":"ca","cebuano":"ceb",
  "cen":"cen","central kurdish":"ckb","central nahuatl":"nhn","central pame":"pbs","central pashto":"pst",
  "central puebla nahuatl":"ncx","central tarahumara":"tar","central yupik":"esu","central-eastern niger fulfulde":"fuq","chadian arabic":"shu",
  "chichewa":"ny","chichicapan zapotec":"zpv","chiga":"cgg","chimalapa zoque":"zoh","chimborazo highland quichua":"qug",
  "chinese":"zh","chiquián ancash quechua":"qxa","chitwania tharu":"the","chokwe":"cjk","chuvash":"cv",
  "cibak":"ckl","coastal konjo":"kjc","copainalá zoque":"zoc","cornish":"kw","corongo ancash quechua":"qwa",
  "croatian":"hr","cross river mbembe":"mfn","cuyamecalco mixtec":"xtu","czech":"cs","dadiya":"dbd",
  "dagbani":"dag","dameli":"dml","danish":"da","dargwa":"dar","dazaga":"dzg",
  "deccan":"dcc","degema":"deg","dera (nigeria)":"kna","dghwede":"dgh","dhatki":"mki",
  "dhivehi":"dv","dhofari arabic":"adf","dijim-bwilim":"cfa","dogri":"dgo","domaaki":"dmk",
  "dotyali":"dty","duala":"dua","dutch":"nl","dũya":"ldb","dyula":"dyu",
  "eastern balochi":"bgp","eastern bolivian guaraní":"gui","eastern egyptian bedawi arabic":"avl","eastern krahn":"kqo","eastern mari":"mhr",
  "eastern yiddish":"ydd","ebrié":"ebr","eggon":"ego","egyptian arabic":"arz","ejagham":"etu",
  "eleme":"elm","eloyi":"afo","embu":"ebu","english":"en","erzya":"myv",
  "esan":"ish","esperanto":"eo","estonian":"et","eton (cameroon)":"eto","ewondo":"ewo",
  "extremaduran":"ext","fang (equatorial guinea)":"fan","fanti":"fat","farefare":"gur","fe'fe'":"fmp",
  "filipino":"fil","filomena mata-coahuitlán totonac":"tlp","finnish":"fi","fipa":"fip","french":"fr",
  "fulah":"ff","galician":"gl","gambian wolof":"wof","ganda":"lg","garhwali":"gbm",
  "gawar-bati":"gwt","gawri":"gwc","gbagyi":"gbr","gbari":"gby","geji":"gyz",
  "gen":"gej","georgian":"ka","german":"de","geser-gorom":"ges","gheg albanian":"aln",
  "ghomálá'":"bbj","gidar":"gid","glavda":"glw","goan konkani":"gom","goaria":"gig",
  "goemai":"ank","gola":"gol","greek":"el","guarani":"gn","guduf-gava":"gdf",
  "guerrero amuzgo":"amu","gujarati":"gu","gujari":"gju","gulf arabic":"afb","gurgula":"ggg",
  "gusii":"guz","gusilay":"gsl","gweno":"gwe","güilá zapotec":"ztu","hadothi":"hoj",
  "hahon":"hah","haitian":"ht","hakha chin":"cnh","hakö":"hao","halia":"hla",
  "hausa":"ha","hawaiian":"haw","hazaragi":"haz","hebrew":"he","hemba":"hem",
  "herero":"hz","highland konjo":"kjk","hijazi arabic":"acw","hindi":"hi","huarijio":"var",
  "huautla mazatec":"mau","huaxcaleca nahuatl":"nhq","huba":"hbb","huitepec mixtec":"mxs","hula":"hul",
  "hungarian":"hu","hunjara-kaina ke":"hkk","hwana":"hwo","ibibio":"ibb","icelandic":"is",
  "idakho-isukha-tiriki":"ida","idoma":"idu","igbo":"ig","igo":"ahl","ikposo":"kpo",
  "ikwere":"ikw","imbabura highland quichua":"qvi","indonesian":"id","indus kohistani":"mvy","interlingua (international auxiliary language association)":"ia",
  "inupiaq":"ik","irish":"ga","iron ossetic":"os","isekiri":"its","isoko":"iso",
  "italian":"it","ito":"itw","itzá":"itz","ixtayutla mixtec":"vmj","izon":"ijc",
  "jambi malay":"jax","japanese":"ja","jaqaru":"jqr","jauja wanca quechua":"qxw","jaunsari":"jns",
  "javanese":"jv","jiba":"juo","jju":"kaj","judeo-moroccan arabic":"aju","juxtlahuaca mixtec":"vmc",
  "kabardian":"kbd","kabras":"lkb","kabuverdianu":"kea","kabyle":"kab","kachi koli":"gjk",
  "kairak":"ckr","kalabari":"ijn","kalasha":"kls","kalenjin":"kln","kalkoti":"xka",
  "kamba":"kam","kamo":"kcq","kanauji":"bjj","kanembu":"kbl","kannada":"kn",
  "karekare":"kai","kashmiri":"ks","kathoriya tharu":"tkt","kati":"bsh","kazakh":"kk",
  "keiyo":"eyo","khams tibetan":"khg","khana":"ogo","khetrani":"xhe","khmer":"km",
  "khowar":"khw","kinga":"zga","kinnauri":"kfk","kinyarwanda":"rw","kirghiz":"ky",
  "kirya-konzəl":"fkk","kochila tharu":"thq","kohistani shina":"plk","kohumono":"bcs","kok borok":"trp",
  "kol (papua new guinea)":"kol","kom (cameroon)":"bkm","koma":"kmy","konkani":"knn","konzo":"koo",
  "korean":"ko","korwa":"kfp","kota (india)":"kfe","koti":"eko","kuanua":"ksd",
  "kuanyama":"kj","kui (india)":"uki","kulung (nigeria)":"bbu","kuot":"kto","kushi":"kuh",
  "kwambi":"kwm","kwasio":"nmg","lala-roba":"lla","lamang":"hia","lao":"lo",
  "larike-wakasihu":"alo","lasi":"lss","latgalian":"ltg","latvian":"lv","levantine arabic":"apc",
  "liana-seti":"ste","liberia kpelle":"xpe","liberian english":"lir","libyan arabic":"ayl","ligurian":"lij",
  "lijili":"mgi","lingala":"ln","lithuanian":"lt","loarki":"lrk","logooli":"rag",
  "logudorese sardinian":"src","loja highland quichua":"qvj","loloda":"loa","longuda":"lnu","loxicha zapotec":"ztp",
  "luba-lulua":"lua","luo":"luo","lushai":"lus","luxembourgish":"lb","maasina fulfulde":"ffm",
  "maba (chad)":"mde","macedo-romanian":"rup","macedonian":"mk","mada (cameroon)":"mxu","mafa":"maf",
  "maithili":"mai","malay":"ms","malayalam":"ml","mali":"gcc","malinaltepec me'phaa":"tcf",
  "maltese":"mt","mandara":"tbf","mandjak":"mfv","manggarai":"mqy","manipuri":"mni",
  "mansoanka":"msw","manx":"gv","maori":"mi","marathi":"mr","marghi central":"mrt",
  "marghi south":"mfm","maria (india)":"mrr","marwari (pakistan)":"mve","masana":"mcn","masikoro malagasy":"msh",
  "matsés":"mcf","mazaltepec zapotec":"zpy","mazatlán mazatec":"vmz","mazatlán mixe":"mzl","mbe":"mfo",
  "mbo (cameroon)":"mbo","mbum":"mdd","medumba":"byv","mekeo":"mek","meru":"mer",
  "mesopotamian arabic":"acm","mewari":"mtr","min nan chinese":"nan","mingrelian":"xmf","mitlatongo mixtec":"vmm",
  "miya":"mkf","mokpwe":"bri","moksha":"mdf","mom jango":"ver","mongolian":"mn",
  "moroccan arabic":"ary","motu":"meu","mpiemo":"mcx","mpumpong":"mgg","mundang":"mua",
  "mungaka":"mhk","musey":"mse","musgu":"mug","musi":"mui","naba":"mne",
  "najdi arabic":"ars","nalik":"nal","nawdm":"nmz","ndonga":"ng","neapolitan":"nap",
  "nepali":"npi","ngamo":"nbh","ngas":"anc","ngiemboon":"nnh","ngizim":"ngi",
  "ngomba":"jgo","ngombale":"nla","nigerian fulfulde":"fuv","nigerian pidgin":"pcm","nimadi":"noe",
  "nobiin":"fia","north mesopotamian arabic":"ayp","north moluccan malay":"max","northern betsimisaraka malagasy":"bmm","northern hindko":"hno",
  "northern kurdish":"kmr","northern pame":"pmq","northern pashto":"pbu","northern uzbek":"uzn","northwest gbaya":"gya",
  "norwegian":"no","norwegian bokmål":"nb","norwegian nynorsk":"nn","notsi":"ncf","nyankpa":"yes",
  "nyungwe":"nyu","nzanyi":"nja","nüpode huitoto":"hux","occitan":"oc","od":"odk",
  "odia":"ory","odual":"odu","omani arabic":"acx","orizaba nahuatl":"nlv","orma":"orc",
  "ormuri":"oru","oromo":"om","pahari-potwari":"phr","paiwan":"pwn","panjabi":"pa",
  "papuan malay":"pmy","parkari koli":"kvx","pedi":"nso","pero":"pip","persian":"fa",
  "petats":"pex","phalura":"phl","piemontese":"pms","piya-kwonci":"piy","plateau malagasy":"plt",
  "polish":"pl","poqomam":"poc","portuguese":"pt","pulaar":"fuc","pular":"fuf",
  "puno quechua":"qxp","pushto":"ps","pökoot":"pko","qaqet":"byx","quiotepec chinantec":"chq",
  "rana tharu":"thr","rangi":"lag","rapoisi":"kyx","ratahan":"rth","rayón zoque":"zor",
  "romanian":"ro","romansh":"rm","rombo":"rof","rotokas":"roo","rukai":"dru",
  "russian":"ru","sacapulteco":"quv","saidi arabic":"aec","sakalava malagasy":"skg","sakizaya":"szy",
  "saleman":"sau","samba daka":"ccg","samba leko":"ndi","san felipe otlaltepec popoloca":"pow","san francisco del mar huave":"hue",
  "san juan atzingo popoloca":"poe","san martín itunyoso triqui":"trq","san miguel el grande mixtec":"mig","sansi":"ssi","sanskrit":"sa",
  "santa ana de tusi pasco quechua":"qxt","santa catarina albarradas zapotec":"ztn","santali":"sat","santiago del estero quichua":"qus","saposa":"sps",
  "saraiki":"skr","sardinian":"sc","saya":"say","sediq":"trv","serbian":"sr",
  "seri":"sei","shina":"scl","shona":"sn","siar-lak":"sjr","sibe":"nco",
  "sicilian":"scn","sihuas ancash quechua":"qws","sikkimese":"sip","sinaugoro":"snc","sindhi":"sd",
  "sindhi bhil":"sbn","sinhala":"si","sinicahua mixtec":"xti","sipacapense":"qum","siwai":"siw",
  "slovak":"sk","slovenian":"sl","solos":"sol","somali":"so","soninke":"snk",
  "south giziga":"giz","south ucayali ashéninka":"cpy","southeastern nochixtlán mixtec":"mxy","southern betsimisaraka malagasy":"bzc","southern pashto":"pbt",
  "southern pastaza quechua":"qup","soyaltepec mazatec":"vmp","spanish":"es","standard arabic":"arb","standard moroccan tamazight":"zgh",
  "sudanese arabic":"apd","sulka":"sua","svan":"sva","swahili":"sw","swedish":"sv",
  "tae'":"rob","tahaggart tamahaq":"thv","taita":"dav","tajik":"tg","tamil":"ta",
  "tandroy-mahafaly malagasy":"tdx","tangale":"tan","tanosy malagasy":"txy","tarok":"yer","tatar":"tt",
  "tedaga":"tuq","telugu":"te","tem":"kdh","teop":"tio","tepeuxila cuicatec":"cux",
  "tepinapa chinantec":"cte","tera":"ttr","terei":"buo","termanu":"twu","tesaka malagasy":"tkg",
  "tetelcingo nahuatl":"nhg","teutila cuicatec":"cut","thai":"th","tibetan":"bo","tidaá mixtec":"mtx",
  "tidore":"tvo","tigak":"tgc","tigre":"tig","tigrinya":"ti","tilquiapan zapotec":"zts",
  "tinputz":"tpz","tlacoapa me'phaa":"tpl","tlacoatzintepec chinantec":"ctl","tlingit":"tli","toki pona":"tok",
  "tomoip":"tqp","tondano":"tdn","tonsea":"txs","tooro":"ttj","torau":"ttu",
  "torwali":"trw","tsimihety malagasy":"xmw","tsotso":"lto","tswana":"tn","tugen":"tuy",
  "tuki":"bag","tula":"tul","tulu":"tcy","tunen":"tvu","tungag":"lcm",
  "tunisian arabic":"aeb","tupuri":"tui","turkana":"tuv","turkish":"tr","turkmen":"tk",
  "tututepec mixtec":"mtu","twi":"tw","ubaghara":"byc","uighur":"ug","ukrainian":"uk",
  "umbundu":"umb","upper sorbian":"hsb","urdu":"ur","ushojo":"ush","uzbek":"uz",
  "vai":"vai","vietnamese":"vi","votic":"vot","võro":"vro","waci gbe":"wci",
  "wadiyara koli":"kxp","waja":"wja","wakhi":"wbl","wanga":"lwg","wapan":"juk",
  "warji":"wji","welsh":"cy","wemale":"weo","western frisian":"fy","western highland purepecha":"pua",
  "western juxtlahuaca mixtec":"jmx","western maninkakan":"mlq","western mari":"mrj","western niger fulfulde":"fuh","western panjabi":"pnb",
  "wolof":"wo","wuzlam":"udl","xanaguía zapotec":"ztg","xhosa":"xh","yace":"ekr",
  "yakut":"sah","yalahatan":"jal","yanahuanca pasco quechua":"qur","yangben":"yav","yaqui":"yaq",
  "yauyos quechua":"qux","yekhee":"ets","yiddish":"yi","yidgha":"ydg","yoruba":"yo",
  "yutanduchi mixtec":"mab","zacatlán-ahuacatlán-tepetzintla nahuatl":"nhi","zarma":"dje","zaza":"zza","zulu":"zu",
  "ömie":"aom",
};
// Include both ISO 639-2 bibliographic and terminology forms explicitly. Intl.Locale
// canonicalizes additional legacy codes, scripts and regional BCP 47 subtags.
const isoAliases:Record<string,string> = {
  eng:'en',pol:'pl',deu:'de',ger:'de',fra:'fr',fre:'fr',spa:'es',ita:'it',por:'pt',
  zho:'zh',chi:'zh',jpn:'ja',kor:'ko',rus:'ru',ukr:'uk',ara:'ar',hin:'hi',
  nld:'nl',dut:'nl',tur:'tr',swe:'sv',dan:'da',nor:'no',fin:'fi',ces:'cs',cze:'cs',
  slk:'sk',slo:'sk',hun:'hu',ron:'ro',rum:'ro',bul:'bg',ell:'el',gre:'el',heb:'he',
  ind:'id',msa:'ms',may:'ms',vie:'vi',tha:'th',tam:'ta',tel:'te',ben:'bn',urd:'ur',
  swa:'sw',afr:'af',hrv:'hr',srp:'sr',slv:'sl',lit:'lt',lav:'lv',est:'et',cat:'ca',
  cym:'cy',wel:'cy',eus:'eu',baq:'eu',glg:'gl',isl:'is',ice:'is',mkd:'mk',mac:'mk',
  fas:'fa',per:'fa',nep:'ne',sin:'si',mal:'ml',mar:'mr',guj:'gu',kan:'kn',pan:'pa',
  asm:'as',aze:'az',kaz:'kk',uzb:'uz',
};
const automatic = new Set(['auto','automatycznie','automatic','autodetect','unknown','nieznany','','und','mul','zxx']);
const displayNames = new Intl.DisplayNames('pl',{type:'language',fallback:'none'});
const englishNames = new Intl.DisplayNames('en',{type:'language',fallback:'none'});
function canonicalLanguageTag(value:string):string {
  const tag=value.replaceAll('_','-'),[base,...subtags]=tag.split('-');
  try{return new Intl.Locale([isoAliases[base]||base,...subtags].join('-')).language;}
  catch{return '';}
}
const engineCodes = new Set(Object.values(engineLanguages).map(canonicalLanguageTag));
const aliases = new Map(Object.entries(languageNames).flatMap(([code,names])=>[code,...names].map(name=>[voiceSearchText(name),code])));
const engineDisplayNames = new Map<string,string>();
for(const [name,id] of Object.entries(engineLanguages)){
  const code=canonicalLanguageTag(id);
  aliases.set(voiceSearchText(name),code);
  if(!engineDisplayNames.has(code))engineDisplayNames.set(code,name.charAt(0).toLocaleUpperCase('pl')+name.slice(1));
}
// A translated CLDR name can describe more than one engine language. Explicit
// engine names keep precedence, and display labels must round-trip to their ID.
for(const code of engineCodes)for(const localized of [displayNames.of(code),englishNames.of(code)]){
  if(localized&&!aliases.has(voiceSearchText(localized)))aliases.set(voiceSearchText(localized),code);
}
export function voiceLanguageCode(value:string):string {
  const key=voiceSearchText(value.trim());
  if(automatic.has(key))return '';
  const known=aliases.get(key);if(known)return known;
  const code=canonicalLanguageTag(key);
  // Syntactically plausible arbitrary text and reserved non-language tags must
  // not become languages. Engine IDs remain valid even without CLDR names.
  if(!code||automatic.has(code))return '';
  return engineCodes.has(code)||displayNames.of(code)?code:'';
}
export function voiceLanguage(value:string):string {
  const code=voiceLanguageCode(value);
  if(!code)return 'Automatycznie';
  if(languageNames[code])return languageNames[code][0];
  const localized=displayNames.of(code);
  const name=localized&&aliases.get(voiceSearchText(localized))===code?localized:engineDisplayNames.get(code);
  return name?name.charAt(0).toLocaleUpperCase('pl')+name.slice(1):code;
}
let engineOptions:{value:string;label:string;group:string}[]|undefined;
/** All languages of the pinned engine language map: popular ones (Polish name + flag) first, then the rest; computed once. */
export function engineLanguageOptions():{value:string;label:string;group:string}[] {
  if(engineOptions)return engineOptions;
  const rows=[...engineCodes].map(code=>({value:code,label:voiceLanguage(code),popular:code in languageNames}));
  const sorted=(popular:boolean)=>rows.filter(row=>row.popular===popular).sort((a,b)=>a.label.localeCompare(b.label,'pl'));
  const popular=sorted(true),rest=sorted(false);
  return engineOptions=[...popular.map(({value,label})=>({value,label,group:'Popularne'})),...rest.map(({value,label})=>({value,label,group:`Pozostałe (${rest.length})`}))];
}
/** Offer only attributes actually supplied by profiles; do not infer missing data. */
export function availableVoiceFilters(voices:readonly Voice[]):{categories:string[];genders:string[];ageGroups:string[]} {
  const present=new Set(voices.flatMap(voice=>voice.categories||[]).filter(value=>typeof value==='string'&&value.trim()));
  const categories=[...voiceCategories.filter(value=>present.has(value)),...[...present].filter(value=>!voiceCategories.includes(value)).sort((a,b)=>a.localeCompare(b,'pl'))];
  return {categories,genders:['female','male','neutral'].filter(value=>voices.some(voice=>voice.gender===value)),ageGroups:['young','adult','mature'].filter(value=>voices.some(voice=>voice.ageGroup===value))};
}
export function normalizeVoiceLanguages(values:readonly string[]):string[] {
  const result=new Map<string,string>();
  for(const value of values){const code=voiceLanguageCode(value);if(code&&!result.has(code))result.set(code,voiceLanguage(value));}
  return [...result.values()];
}
/** A recording language is not a verified list of generation capabilities. */
export function voiceLanguageSupport(voice:Voice,modelLanguages:readonly string[]=[]):{languages:string[];source:'profile'|'model'|'sample';sample:string} {
  const declared=normalizeVoiceLanguages(voice.supportedLanguages||[]),model=normalizeVoiceLanguages(modelLanguages);
  const sample=voiceLanguageCode(voice.language)?voiceLanguage(voice.language):'';
  if(declared.length){const available=new Set(model.map(voiceLanguageCode));return {languages:model.length?declared.filter(language=>available.has(voiceLanguageCode(language))):declared,source:'profile',sample};}
  if(model.length)return {languages:model,source:'model',sample};
  return {languages:sample?[sample]:[],source:'sample',sample};
}
export function voiceLanguageCount(count:number):string {
  return `${count} ${count===1?'język':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'języki':'języków'}`;
}
export function filterVoices(voices:Voice[], filters:VoiceFilters,modelLanguages:readonly string[]=[]):Voice[] {
  const words=voiceSearchText(filters.query).trim().split(/\s+/).filter(Boolean);
  return voices.filter(voice=>{
    const support=voiceLanguageSupport(voice,modelLanguages);
    const text=voiceSearchText([voice.id,voice.name,voice.description,voice.language,voiceLanguage(voice.language),voice.kind,voice.accent,...(voice.categories||[]),...support.languages.flatMap(language=>[language,...(languageNames[voiceLanguageCode(language)]||[])])].filter(Boolean).join(' '));
    return words.every(word=>text.includes(word))
      && (filters.language==='all'||support.languages.some(language=>voiceLanguageCode(language)===voiceLanguageCode(filters.language)))
      && (!filters.categories.length||filters.categories.some(category=>voice.categories?.includes(category)))
      && (filters.kind==='all'||voice.kind===filters.kind)
      && (filters.gender==='all'||voice.gender===filters.gender)
      && (filters.ageGroup==='all'||voice.ageGroup===filters.ageGroup)
      && (!filters.library||voice.inLibrary===true||!voice.demo);
  });
}
