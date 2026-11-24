# Comprobación visual de Hoy y Operaciones con datos 100 % ficticios (no se sube a producción nada).
# Uso: python3 tests/visual-check.py  → capturas en /tmp/orbit-shots/*.png y errores de consola.
import json, os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/tmp/orbit-shots'; os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
today = datetime.date.today()
d = lambda n: (today + datetime.timedelta(days=n)).isoformat()
ym = today.strftime('%Y-%m')

def series(start, n, p0, step):
    vals, p = [], p0
    for k in range(n):
        day = datetime.date.fromisoformat(start) + datetime.timedelta(days=k)
        p = round(p * (1 + step[k % len(step)]), 2)
        vals.append({'datetime': day.isoformat(), 'open': p, 'high': round(p * 1.01, 2), 'low': round(p * .99, 2), 'close': p})
    return {'values': list(reversed(vals)), 'status': 'ok'}

IDEAS = [
  {'id': 'i1', 'ticker': 'ACME', 'title': 'ACME: rebote tras una caída exagerada', 'summary': 'Idea ficticia de prueba.', 'doc_url': 'https://example.com/doc',
   'direction': 'alcista', 'entry_price': 100, 'target_price': 116, 'stop_price': 92, 'currency': 'USD', 'expires_on': d(40), 'status': 'abierta',
   'result_pct': 4.2, 'result_eur': None, 'size_eur': 1000, 'executed': False, 'price_symbol': 'ACME', 'entry_date': d(-12), 'last_price': 104.2,
   'last_price_date': d(-1), 'exit_price': None, 'closed_on': None, 'reviewed_at': d(-1) + 'T07:00:00Z', 'created_at': d(-12) + 'T09:00:00Z'},
  {'id': 'i2', 'ticker': 'GLBX', 'title': 'GLBX: catalizador de resultados', 'summary': 'Idea ficticia cerrada en objetivo.', 'doc_url': None,
   'direction': 'alcista', 'entry_price': 50, 'target_price': 56, 'stop_price': 47, 'currency': 'USD', 'expires_on': d(-5), 'status': 'objetivo',
   'result_pct': 12, 'result_eur': 118, 'size_eur': 1000, 'executed': False, 'price_symbol': 'GLBX', 'entry_date': d(-40), 'last_price': 56,
   'last_price_date': d(-20), 'exit_price': 56, 'closed_on': d(-20), 'reviewed_at': d(-20) + 'T07:00:00Z', 'created_at': d(-40) + 'T09:00:00Z'},
  {'id': 'i3', 'ticker': 'XAU', 'title': 'Oro: rebote', 'summary': 'Idea ficticia cerrada por salida.', 'doc_url': None,
   'direction': 'alcista', 'entry_price': 2000, 'target_price': 2160, 'stop_price': 1920, 'currency': 'USD', 'expires_on': d(-2), 'status': 'stop',
   'result_pct': -4, 'result_eur': -22, 'size_eur': 500, 'executed': True, 'price_symbol': 'XAU/USD', 'entry_date': d(-30), 'last_price': 1920,
   'last_price_date': d(-8), 'exit_price': 1920, 'closed_on': d(-8), 'reviewed_at': d(-8) + 'T07:00:00Z', 'created_at': d(-30) + 'T09:00:00Z'},
]
SETUP = """
([ideas, ym]) => {
  const q = (rows) => { const c = { _r: rows, select(){return c}, eq(k,v){c._r=c._r.filter(r=>r[k]===v);return c}, neq(k,v){c._r=c._r.filter(r=>r[k]!==v);return c},
    order(){return c}, limit(){return c}, in(){return c}, gte(){return c}, lte(){return c}, is(){return c}, single(){return Promise.resolve({data:c._r[0]||null,error:null})},
    maybeSingle(){return Promise.resolve({data:c._r[0]||null,error:null})}, then(res,rej){return Promise.resolve({data:c._r,error:null}).then(res,rej)},
    insert(){return c}, update(){return c}, upsert(){return c}, delete(){return c} }; return c; };
  const notes = [...ideas.map(i => ({...i, kind:'idea'})), {id:'n1',kind:'cartera',title:'Revisión semanal (ficticia)',summary:'Resumen de prueba.',created_at:new Date().toISOString()}];
  sb = { from: (t) => q(t === 'orbit_notes' ? notes.slice() : []), auth: { getSession: async () => ({data:{session:null}}), signOut: async()=>({}) },
    storage: { from: () => ({}) }, rpc: async () => ({data:null,error:null}) };
  demo = false; user = {id:'u-test', email:'test@example.com', user_metadata:{full_name:'Prueba'}};
  const now = new Date().toISOString();
  blocks = [
    {id:'c1',type:'cash',name:'Cuenta A',value:3000,eur_value:3000,currency:'EUR',extra:{},updated_at:now},
    {id:'c2',type:'cash',name:'Cuenta remunerada B',value:4500,eur_value:4500,currency:'EUR',extra:{},updated_at:now},
    {id:'b1',type:'bolsa',name:'Bróker',value:8000,eur_value:8000,currency:'EUR',extra:{positions:[
      {ticker:'IDXA',name:'ETF índice A',type:'ETF',value:3600,qty:30,entry:110,lastPrice:120,currency:'EUR',priceCurrency:'EUR',price_stale:true,price_date:null,price_error:'ETF europeo no cubierto'},
      {ticker:'IDXB',name:'ETF índice B',type:'ETF',value:2100,qty:40,entry:50,lastPrice:52.5,currency:'EUR',priceCurrency:'EUR',price_stale:false,price_date:'%(y)s'},
      {ticker:'IDXC',name:'ETF emergentes C',type:'ETF',value:1400,qty:25,entry:55,lastPrice:56,currency:'EUR',priceCurrency:'EUR',price_stale:true},
      {ticker:'ACME',name:'Acme Corp',type:'EQUITY',value:500,qty:5,entry:110,lastPrice:109,currency:'USD',priceCurrency:'USD',price_stale:false,price_date:'%(y)s',price_source:'TwelveData'},
      {ticker:'GLBX',name:'Globex Inc',type:'EQUITY',value:400,qty:4,entry:90,lastPrice:110,currency:'USD',priceCurrency:'USD',price_stale:false,price_date:'%(y)s',price_source:'TwelveData'}]},updated_at:now},
    {id:'r1',type:'fondos',name:'Robo-advisor',value:2500,eur_value:2500,currency:'EUR',extra:{},updated_at:now},
    {id:'p1',type:'pe',name:'Fondo PE de prueba',value:1300,eur_value:1300,currency:'EUR',extra:{committed:5000,called:1250,distributed:0},updated_at:now},
  ];
  history = [{date:'2026-08-01',total:15000},{date:'2026-09-01',total:16000},{date:'2026-10-01',total:17500},{date:'2026-11-01',total:19000}];
  const mi = new Date().getMonth();
  expenseData = { X: { name:'X', num: mi+1, year: new Date().getFullYear(), items: [
    {id:'e1',amount:120,category:'Menjar',date:ym+'-03'},{id:'e2',amount:65,category:'Transport',date:ym+'-05'},
    {id:'e3',amount:240,category:'Oci',date:ym+'-08'},{id:'e4',amount:40,category:'Menjar',date:ym+'-10'},{id:'e5',amount:30,category:'Altres',date:ym+'-11'}]}};
  try { localStorage.setItem(budgetsKey(), JSON.stringify({Menjar:250, Oci:150})); } catch(e) {}
  renderSidebar(); goto('dashboard'); renderDash();
}
""".replace('%(y)s', d(-1))

def market(route):
    url = route.request.url
    from urllib.parse import urlparse, parse_qs
    qs = parse_qs(urlparse(url).query); u = qs.get('u', [''])[0]; sym = qs.get('symbol', [''])[0] or (u.split('symbol=')[1] if 'symbol=' in u else '')
    if u.startswith('/quote'):
        body = {'symbol': sym, 'percent_change': '1.37' if sym == 'ACME' else '-0.82', 'close': '109', 'datetime': d(-1)}
    elif u.startswith('/time_series'):
        body = {'ACME': series(d(-22), 22, 98, [.01, -.004, .006]), 'GLBX': series(d(-50), 30, 48, [.006, .004, -.002]), 'XAU/USD': series(d(-40), 33, 2050, [-.006, .002, -.004])}.get(sym, {'status': 'error', 'message': 'symbol not found'})
    else:
        body = {}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

errors = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for name, vp, mobile in [('desktop', {'width': 1360, 'height': 2700}, False), ('mobile', {'width': 390, 'height': 4200}, True)]:
        ctx = br.new_context(viewport=vp, is_mobile=mobile, device_scale_factor=2 if mobile else 1)
        pg = ctx.new_page()
        pg.on('console', lambda m: errors.append(f'[{name}] {m.type}: {m.text[:160]}') if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'tipos de cambio' not in m.text and 'tipo de cambio' not in m.text and 'Supabase SDK' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(f'[{name}] pageerror: {e}'))
        pg.route('**/api/market**', market)
        pg.route('**/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{}') if '/api/market' not in r.request.url else r.fallback())
        pg.goto('http://127.0.0.1:8765/index.html', wait_until='domcontentloaded')
        pg.wait_for_timeout(7000)
        pg.evaluate('() => { window.Chart = window.Chart || class { constructor(){} destroy(){} update(){} }; }')
        pg.evaluate('enterDemo()')
        pg.wait_for_timeout(2500)
        pg.evaluate(SETUP, [IDEAS, ym])
        pg.wait_for_timeout(1800)
        pg.evaluate("() => document.querySelectorAll('.overlay, .modal-bg, .mo, [id^=m-]').forEach(e => { if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; })")
        pg.screenshot(path=f'{OUT}/{name}-hoy.png', full_page=True)
        pg.evaluate("goto('trading')")
        pg.wait_for_timeout(4500)
        pg.evaluate("() => document.querySelectorAll('.overlay, .modal-bg, .mo, [id^=m-]').forEach(e => { if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; })")
        pg.screenshot(path=f'{OUT}/{name}-operaciones.png', full_page=True)
        ctx.close()
    br.close()
srv.terminate()
print('\n'.join(errors) or 'Sin errores de consola')
