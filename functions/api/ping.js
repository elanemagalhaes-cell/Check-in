export const onRequestGet = async () => {
  return new Response(JSON.stringify({ ok: true, msg: "pong" }), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
};
