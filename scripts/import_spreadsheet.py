import argparse, json, math, os, re, unicodedata, urllib.parse, urllib.request
from datetime import date, datetime, time
import pandas as pd

def env_file(path):
    for line in open(path, encoding='utf-8'):
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.rstrip().split('=', 1)
            os.environ[key] = value.strip().strip('"')

def clean(value):
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value): return None
    if isinstance(value, time): return value.isoformat()
    if isinstance(value, (pd.Timestamp, datetime, date)): return value.isoformat()[:10]
    if hasattr(value, 'item'): value = value.item()
    return value

def text(value):
    value = clean(value)
    return '' if value is None else str(value).strip()

def boolean(value): return text(value).lower() in ('sim', 's', 'true', '1', 'yes')
def number(value):
    value = clean(value)
    try: return float(value) if value is not None else None
    except: return None

def norm(value):
    return ''.join(c for c in unicodedata.normalize('NFD', text(value).lower()) if unicodedata.category(c) != 'Mn')

def api(method, table, query='', body=None):
    url = f"{os.environ['SUPABASE_URL']}/rest/v1/{table}{('?' + query) if query else ''}"
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'apikey': os.environ['SUPABASE_SECRET_KEY'], 'Authorization': 'Bearer ' + os.environ['SUPABASE_SECRET_KEY'],
        'Content-Type': 'application/json', 'Prefer': 'return=representation'
    })
    with urllib.request.urlopen(req) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def stage(status):
    value = norm(status)
    if 'venda finalizada' in value: return 9
    if 'assinatura 7lm' in value: return 7
    if 'credit' in value and 'fase' in value: return 6
    if value == 'credito': return 4
    if 'sienge' in value: return 3
    if 'secretaria' in value: return 2
    return 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file'); parser.add_argument('--env', default='.env.import.local'); parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(); env_file(args.env)
    df = pd.read_excel(args.file); cols = list(df.columns)
    org = api('GET', 'organizations', 'slug=eq.7lm&select=id')[0]; org_id = org['id']
    existing = api('GET', 'reservations', f'organization_id=eq.{org_id}&select=id,code,client_id,operational_data,financial_data') or []
    by_code = {str(item['code']): item for item in existing}
    existing_clients = api('GET', 'clients', f'organization_id=eq.{org_id}&select=id,full_name,cpf_cnpj') or []
    clients_by_cpf = {re.sub(r'\D','',item.get('cpf_cnpj') or ''): item['id'] for item in existing_clients if item.get('cpf_cnpj')}
    clients_by_name = {norm(item.get('full_name')): item['id'] for item in existing_clients if item.get('full_name')}
    stats = {'validas': 0, 'novas': 0, 'atualizadas': 0, 'clientes_novos': 0, 'transferencias': 0}
    for _, row in df.iterrows():
        raw_code = clean(row.iloc[0])
        if raw_code is None: continue
        code = str(int(raw_code)) if isinstance(raw_code, (int, float)) else text(raw_code)
        if not code: continue
        stats['validas'] += 1
        source = {str(cols[i]): clean(row.iloc[i]) for i in range(len(cols))}
        old = by_code.get(code)
        client = {
            'organization_id': org_id, 'full_name': text(row.iloc[17]) or f'Cliente reserva {code}',
            'phone': text(row.iloc[20]) or text(row.iloc[19]) or None, 'email': text(row.iloc[21]) or None,
            'cpf_cnpj': re.sub(r'\D', '', text(row.iloc[18])) or None, 'gross_income': number(row.iloc[140]),
            'metadata': {'nacionalidade': clean(row.iloc[22]), 'naturalidade': clean(row.iloc[23]), 'estado': clean(row.iloc[24]),
                'cidade': clean(row.iloc[25]), 'bairro': clean(row.iloc[26]), 'endereco': clean(row.iloc[27]), 'codigo_origem': clean(row.iloc[10])}
        }
        if args.apply:
            if old:
                api('PATCH', 'clients', 'id=eq.' + old['client_id'], client); client_id = old['client_id']
            else:
                client_id = clients_by_cpf.get(client['cpf_cnpj'] or '') or clients_by_name.get(norm(client['full_name']))
                if client_id: api('PATCH', 'clients', 'id=eq.' + client_id, client)
                else:
                    client_id = api('POST', 'clients', '', client)[0]['id']; stats['clientes_novos'] += 1
                    if client['cpf_cnpj']: clients_by_cpf[client['cpf_cnpj']] = client_id
                    clients_by_name[norm(client['full_name'])] = client_id
        else: client_id = old['client_id'] if old else 'dry-run-client'
        operational = dict((old or {}).get('operational_data') or {})
        operational.update({
            'planilha': source, 'bloco': clean(row.iloc[7]), 'areaUnidade': clean(row.iloc[9]), 'titulo': clean(row.iloc[16]),
            'dataPosse': clean(row.iloc[57]), 'condicionante': clean(row.iloc[58]), 'classificacaoPosVenda': clean(row.iloc[59]),
            'observacaoPosVenda': clean(row.iloc[60]), 'classificacaoCliente': clean(row.iloc[61]), 'previsaoEntrega': clean(row.iloc[64]),
            'dataVenda': clean(row.iloc[65]), 'mesCompetencia': clean(row.iloc[83]), 'tipoVendaFinanceiro': clean(row.iloc[44]),
            'tabelaPreco': clean(row.iloc[124]), 'dataContrato': clean(row.iloc[131]), 'situacaoRepasse': clean(row.iloc[132]),
            'quantidadeFilhos': clean(row.iloc[133]), 'cidadeOrigem': clean(row.iloc[134]), 'bairroOrigem': clean(row.iloc[135]),
            'situacaoCreditu': clean(row.iloc[136]), 'rendaInformal': clean(row.iloc[138]), 'dataConformidadeCehop': clean(row.iloc[139]),
            'rendaFormal': clean(row.iloc[140]), 'tipoRenda': clean(row.iloc[141]), 'dataEnvioCehop': clean(row.iloc[142]),
            'kitRegistroOk': clean(row.iloc[143]), 'categoriaFiador': clean(row.iloc[144]), 'dataEspelhoAnexado': clean(row.iloc[146]),
            'dataValidacaoEspelho': clean(row.iloc[147]), 'tresAnosFgts': clean(row.iloc[148]), 'aprovacaoFichaAgehab': clean(row.iloc[149]),
            'dataAssinaturaConfissao': clean(row.iloc[151]), 'dataReenvioCehop': clean(row.iloc[152]), 'envioFichaAgehab': clean(row.iloc[153]),
            'dataInconformidadeCehop': clean(row.iloc[154]), 'dataConfissao': clean(row.iloc[155]), 'cadastroFichaAgehab': clean(row.iloc[156]),
            'fichaAgehab': clean(row.iloc[157]), 'observacaoFinalizacao': clean(row.iloc[158]), 'contratoPortal': clean(row.iloc[162]),
            'obsAgehab': clean(row.iloc[163]), 'comissaoAp': clean(row.iloc[164]), 'excecaoCaixa': clean(row.iloc[165]), 'bonusAp': clean(row.iloc[166])
        })
        financial = dict((old or {}).get('financial_data') or {})
        financial.update({'valorContratoReserva': number(row.iloc[33]), 'valorPresente': number(row.iloc[34]),
            'valorFinanciamento': number(row.iloc[69]), 'valorSubsidio': number(row.iloc[70]), 'valorFgts': number(row.iloc[71]),
            'valorTotal': number(row.iloc[72]), 'comissaoCorretor': number(row.iloc[90]), 'comissaoImobiliaria': number(row.iloc[91]),
            'totalComissao': number(row.iloc[94])})
        reservation = {'organization_id': org_id, 'client_id': client_id, 'code': code, 'broker_name': text(row.iloc[28]) or None,
            'real_estate_agency': text(row.iloc[31]) or None, 'development': text(row.iloc[5]) or None, 'unit': text(row.iloc[8]) or None,
            'current_stage': stage(row.iloc[4]), 'status': text(row.iloc[4]) or 'Em processo', 'credit_provider': boolean(row.iloc[137]),
            'monthly_transfer': norm(row.iloc[150]) in ('sim', 'probabilidade de cair'), 'notes': text(row.iloc[158]) or text(row.iloc[60]) or text(row.iloc[43]) or None,
            'operational_data': operational, 'financial_data': financial}
        if old:
            stats['atualizadas'] += 1
            if args.apply: api('PATCH', 'reservations', 'id=eq.' + old['id'], reservation)
            reservation_id = old['id']
        else:
            stats['novas'] += 1
            reservation_id = api('POST', 'reservations', '', reservation)[0]['id'] if args.apply else 'dry-run-reservation'
        transfer_status = text(row.iloc[132])
        if transfer_status:
            stats['transferencias'] += 1
            if args.apply:
                payload = {'organization_id': org_id, 'reservation_id': reservation_id, 'code': f'REP-{code}', 'status': transfer_status,
                    'correspondent_company': text(row.iloc[32]) or None, 'financed_amount': number(row.iloc[69]) or 0,
                    'financial_data': {'valorContrato': number(row.iloc[33]), 'valorPresente': number(row.iloc[34])},
                    'contract_data': {'dataAssinatura': clean(row.iloc[151]), 'dataContrato': clean(row.iloc[131])}}
                found = api('GET', 'transfers', f'organization_id=eq.{org_id}&code=eq.REP-{code}&select=id')
                api('PATCH' if found else 'POST', 'transfers', ('id=eq.' + found[0]['id']) if found else '', payload)
    print(json.dumps({'modo': 'aplicado' if args.apply else 'simulacao', **stats}, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
