/* Seedsman Service — business details and hedge prices.
   This is the only file you need to edit to change prices. All prices are in AUD and include GST. */
window.SEEDSMAN = {
  business: {
    name: 'Seedsman Service',
    phone: '',            // e.g. '0400 000 000' (shown on quotes when filled in)
    email: '',            // quotes are emailed to this address from the quote page
    abn: ''
  },

  // Where the map opens (Toowoomba). Change to your home base if needed.
  mapStart: { lat: -27.5598, lng: 151.9507, zoom: 15 },

  hedge: {
    // Price per metre for ONE face (one side) of the hedge, by height.
    heights: [
      { id: 'h1', label: 'Up to 1.2 m',  perMetre: 6 },
      { id: 'h2', label: '1.2 – 2 m',    perMetre: 9 },
      { id: 'h3', label: '2 – 3 m',      perMetre: 14 },
      { id: 'h4', label: '3 – 4.5 m',    perMetre: 22 }
    ],
    topPerMetre: 3,          // extra per metre to trim the top
    wastePerMetre: 4,        // extra per metre to take the green waste away
    callOut: 0,              // fixed amount added to every quote
    minimum: 120,            // the smallest quote total
    defaultHeight: 'h2',
    defaultFaces: 2,         // 1 = one side, 2 = both sides
    defaultTop: true
  }
};
