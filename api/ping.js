export const config = { runtime: 'nodejs18.x', regions: ['gru1'] };
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='GET') return res.status(405).json({ok:false,msg:'Method not allowed'});
  return res.status(200).json({ok:true,ts:new Date().toISOString(),note:'Ping OK — Node18 gru1'});
}
