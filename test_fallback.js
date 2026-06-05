import { URL } from 'url';
const original='https://prod-api.lzt.market/telegram?page=1&order_by=pdate_to_down&title=%D0%BE%D1%82%D0%BB%D0%B5%D0%B3%D0%B0&perPage=1&resultsPerPage=1';
const alternate='https://api.lzt.market';
try{
  const o=new URL(original);
  const b=new URL(alternate);
  const basePath=b.pathname.replace(/\/+$/,'');
  const fullPath = `${basePath}${o.pathname}`.replace(/\/\/+/,'/');
  const u=new URL(`${fullPath}${o.search}`, `${b.protocol}//${b.hostname}${b.port?`:${b.port}`:''}`);
  console.log(u.toString());
} catch(e) {
  console.error(e);
  process.exit(1);
}
