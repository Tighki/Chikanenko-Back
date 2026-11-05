export const institute = {
  city: "Москва",
  address: "Москва, ул. Студенческая, 1",
  latitude: 55.7558,
  longitude: 37.6173,
};

type Point = { latitude: number; longitude: number };

const cities: Record<string, Point> = {
  москва: { latitude: 55.7558, longitude: 37.6173 },
  "санкт-петербург": { latitude: 59.9343, longitude: 30.3351 },
  петербург: { latitude: 59.9343, longitude: 30.3351 },
  казань: { latitude: 55.7963, longitude: 49.1221 },
  "нижний новгород": { latitude: 56.3269, longitude: 44.0059 },
  екатеринбург: { latitude: 56.8389, longitude: 60.6057 },
  новосибирск: { latitude: 55.0084, longitude: 82.9357 },
  самара: { latitude: 53.1959, longitude: 50.1002 },
  омск: { latitude: 54.9885, longitude: 73.3242 },
  "ростов-на-дону": { latitude: 47.2357, longitude: 39.7015 },
  ростов: { latitude: 47.2357, longitude: 39.7015 },
  уфа: { latitude: 54.7388, longitude: 55.9721 },
  красноярск: { latitude: 56.0153, longitude: 92.8932 },
  воронеж: { latitude: 51.6608, longitude: 39.2003 },
  пермь: { latitude: 58.0105, longitude: 56.2502 },
  волгоград: { latitude: 48.708, longitude: 44.5133 },
  краснодар: { latitude: 45.0355, longitude: 38.9753 },
  саратов: { latitude: 51.5336, longitude: 46.0343 },
  тюмень: { latitude: 57.1522, longitude: 65.5272 },
  тольятти: { latitude: 53.5303, longitude: 49.3461 },
  ижевск: { latitude: 56.8527, longitude: 53.2069 },
  барнаул: { latitude: 53.3481, longitude: 83.7798 },
  ульяновск: { latitude: 54.3142, longitude: 48.4031 },
  иркутск: { latitude: 52.287, longitude: 104.305 },
  хабаровск: { latitude: 48.4827, longitude: 135.0838 },
  ярославль: { latitude: 57.6261, longitude: 39.8845 },
  владивосток: { latitude: 43.1155, longitude: 131.8855 },
  махачкала: { latitude: 42.9849, longitude: 47.5047 },
  томск: { latitude: 56.4977, longitude: 84.9744 },
  оренбург: { latitude: 51.7682, longitude: 55.0969 },
  кемерово: { latitude: 55.3543, longitude: 86.088 },
  новокузнецк: { latitude: 53.7596, longitude: 87.1216 },
  рязань: { latitude: 54.6269, longitude: 39.6916 },
  астрахань: { latitude: 46.3497, longitude: 48.0408 },
  "набережные челны": { latitude: 55.7436, longitude: 52.3958 },
  пенза: { latitude: 53.1951, longitude: 45.0183 },
  липецк: { latitude: 52.6031, longitude: 39.5708 },
  киров: { latitude: 58.6035, longitude: 49.6679 },
  чебоксары: { latitude: 56.1439, longitude: 47.2489 },
  тула: { latitude: 54.1931, longitude: 37.6173 },
  калининград: { latitude: 54.7104, longitude: 20.4522 },
  курск: { latitude: 51.7304, longitude: 36.1926 },
  ставрополь: { latitude: 45.0445, longitude: 41.969 },
  "улан-уде": { latitude: 51.8335, longitude: 107.5841 },
  тверь: { latitude: 56.8587, longitude: 35.9176 },
  магнитогорск: { latitude: 53.4072, longitude: 58.9792 },
  иваново: { latitude: 57.0004, longitude: 40.9739 },
  брянск: { latitude: 53.2434, longitude: 34.3634 },
  белгород: { latitude: 50.5951, longitude: 36.5873 },
  сургут: { latitude: 61.25, longitude: 73.4167 },
  владимир: { latitude: 56.129, longitude: 40.4066 },
  "нижний тагил": { latitude: 57.9101, longitude: 59.9813 },
  архангельск: { latitude: 64.5393, longitude: 40.5187 },
  чита: { latitude: 52.0336, longitude: 113.5013 },
  калуга: { latitude: 54.5293, longitude: 36.2754 },
  смоленск: { latitude: 54.7826, longitude: 32.0453 },
  волжский: { latitude: 48.7858, longitude: 44.7797 },
  череповец: { latitude: 59.1226, longitude: 37.9034 },
  саранск: { latitude: 54.1874, longitude: 45.1839 },
  вологда: { latitude: 59.2205, longitude: 39.8915 },
  якутск: { latitude: 62.0272, longitude: 129.7322 },
  орел: { latitude: 52.9703, longitude: 36.0636 },
  курган: { latitude: 55.4444, longitude: 65.3161 },
  владикавказ: { latitude: 43.0246, longitude: 44.6818 },
  мурманск: { latitude: 68.9585, longitude: 33.0827 },
  тамбов: { latitude: 52.7212, longitude: 41.4523 },
  петрозаводск: { latitude: 61.7849, longitude: 34.3469 },
  кострома: { latitude: 57.7665, longitude: 40.9269 },
  "йошкар-ола": { latitude: 56.6344, longitude: 47.8998 },
  новороссийск: { latitude: 44.7235, longitude: 37.7686 },
  сыктывкар: { latitude: 61.6688, longitude: 50.8364 },
  нальчик: { latitude: 43.4981, longitude: 43.6189 },
  благовещенск: { latitude: 50.2907, longitude: 127.5272 },
  псков: { latitude: 57.8194, longitude: 28.3318 },
  "великий новгород": { latitude: 58.5215, longitude: 31.2755 },
  новгород: { latitude: 58.5215, longitude: 31.2755 },
  биробиджан: { latitude: 48.7946, longitude: 132.9218 },
  "южно-сахалинск": { latitude: 46.9591, longitude: 142.738 },
  магадан: { latitude: 59.5682, longitude: 150.8085 },
  анадырь: { latitude: 64.7333, longitude: 177.5167 },
  грозный: { latitude: 43.318, longitude: 45.6982 },
  элиста: { latitude: 46.3078, longitude: 44.2558 },
  майкоп: { latitude: 44.6078, longitude: 40.1058 },
  черкесск: { latitude: 44.2269, longitude: 42.0468 },
  "горно-алтайск": { latitude: 51.9581, longitude: 85.9603 },
  абакан: { latitude: 53.7212, longitude: 91.4424 },
  кызыл: { latitude: 51.7191, longitude: 94.4378 },
  "ханты-мансийск": { latitude: 61.0042, longitude: 69.0019 },
  салехард: { latitude: 66.53, longitude: 66.6019 },
  назрань: { latitude: 43.2257, longitude: 44.7646 },
  сочи: { latitude: 43.6028, longitude: 39.7342 },
};

function normalizePlace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^(город|г\.|г|пгт|поселок|пос\.|село|с\.|деревня|д\.)\s+/, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineKm(from: Point, to: Point): number {
  const earthKm = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceKmFromCity(city: string): number | null {
  const point = cities[normalizePlace(city)];
  if (!point) return null;
  return Math.round(haversineKm(point, institute));
}
