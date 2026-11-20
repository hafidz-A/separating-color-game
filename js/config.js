// Relay (TURN) settings. A relay lets players on different networks
// (e.g. one on home Wi-Fi, one on mobile data) play together.
//
// Easiest: a free Metered account (https://www.metered.ca/stun-turn).
// After signing up, open the TURN Server page, copy the
// "credentials API" link (it looks like the example below) and paste it here:
//
// window.PILAHPIL_TURN_URL = 'https://YOUR-APP.metered.live/api/v1/turn/credentials?apiKey=YOUR_KEY';
window.PILAHPIL_TURN_URL = '';

// Or list relay servers directly:
// window.PILAHPIL_TURN = [
//   { urls: 'turn:YOUR-SUBDOMAIN.metered.live:80', username: 'USERNAME', credential: 'PASSWORD' },
//   { urls: 'turns:YOUR-SUBDOMAIN.metered.live:443?transport=tcp', username: 'USERNAME', credential: 'PASSWORD' },
// ];
window.PILAHPIL_TURN = [];
