
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  }
});
