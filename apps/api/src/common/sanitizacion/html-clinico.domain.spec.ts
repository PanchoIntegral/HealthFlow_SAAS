import { sanitizarHtml, sanitizarTextoPlano } from './html-clinico';

/** Nada ejecutable ni cargable debe sobrevivir: etiquetas, handlers ni esquemas de URL. */
function sinPeligro(html: string): void {
  expect(html).not.toMatch(/<\s*(script|style|iframe|object|embed|svg|math|img|a|link|meta|base|form|input|textarea|template)\b/i);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/javascript:|vbscript:|data:/i);
  expect(html).not.toMatch(/\s(href|src|srcset|style|action|formaction|xlink:href)\s*=/i);
}

describe('sanitizarHtml (allowlist compatible con TipTap)', () => {
  it('conserva lo que emite el StarterKit de TipTap', () => {
    const tiptap =
      '<p>Refiere <strong>disnea</strong> y <em>ortopnea</em>.</p>' +
      '<ul><li><p>Edema</p></li></ul><ol start="3"><li><p>Tres</p></li></ol>' +
      '<blockquote><p>Cita</p></blockquote><pre><code>TA 130/85</code></pre><p>Uno<br>Dos</p><hr><h2>Plan</h2>';
    // Sólo cambia la forma de las etiquetas vacías (<br> → <br />), que TipTap
    // interpreta igual.
    expect(sanitizarHtml(tiptap)).toBe(tiptap.replace('<br>', '<br />').replace('<hr>', '<hr />'));
  });

  it('escapa el texto, no lo reinterpreta: "TA < 140" sigue siendo texto', () => {
    expect(sanitizarHtml('<p>TA < 140 & FC > 60</p>')).toBe('<p>TA &lt; 140 &amp; FC &gt; 60</p>');
  });

  const ataques: [string, string][] = [
    ['script', '<p>ok</p><script>alert(1)</script>'],
    ['script con mayúsculas y espacios', '<p>ok</p><ScRiPt >alert(1)</sCrIpT >'],
    ['img onerror', '<p>ok<img src=x onerror="alert(1)"></p>'],
    ['handler en etiqueta permitida', '<p onclick="alert(1)" onmouseover=alert(1)>ok</p>'],
    ['enlace javascript', '<p><a href="javascript:alert(1)">ok</a></p>'],
    ['enlace con entidades', '<p><a href="jav&#x09;ascript:alert(1)">ok</a></p>'],
    ['data URL', '<p><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">ok</a></p>'],
    ['svg con onload', '<svg onload=alert(1)><circle/></svg><p>ok</p>'],
    ['iframe', '<iframe src="https://evil.example"></iframe><p>ok</p>'],
    ['style con expresión', '<p style="background:url(javascript:alert(1))">ok</p><style>body{}</style>'],
    ['etiqueta anidada partida', '<p>ok</p><scr<script>ipt>alert(1)</scr</script>ipt>'],
    ['comentario condicional', '<!--[if IE]><script>alert(1)</script><![endif]--><p>ok</p>'],
    ['formulario', '<form action="https://evil.example"><input name=x formaction=javascript:alert(1)></form><p>ok</p>'],
    ['atributo start no numérico', '<ol start="1 onclick=alert(1)"><li>ok</li></ol>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>ok</p>'],
    // Regresiones de avisos publicados de sanitize-html (motivo de fijar >= 2.17.7).
    ['GHSA-jxwj-j7wr-gfrw: cierre </textarea/>', '<p>ok</p><textarea></textarea/><img src=x onerror=alert(1)></textarea>'],
    ['GHSA-g8qq-57p8-ggw5: SVG SMIL', '<p>ok</p><svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>'],
  ];

  it.each(ataques)('neutraliza %s', (_, entrada) => {
    const salida = sanitizarHtml(entrada);
    sinPeligro(salida);
    expect(salida).toContain('ok');
  });

  it('el código de un <script> no queda como texto', () => {
    expect(sanitizarHtml('<p>a</p><script>robarSesion()</script>')).toBe('<p>a</p>');
  });

  it('es idempotente', () => {
    for (const [, entrada] of ataques) {
      const una = sanitizarHtml(entrada);
      expect(sanitizarHtml(una)).toBe(una);
    }
  });
});

describe('sanitizarTextoPlano', () => {
  it('no toca texto normal ni comparaciones', () => {
    expect(sanitizarTextoPlano('TA < 140, FC > 60, <5 min')).toBe('TA < 140, FC > 60, <5 min');
  });

  it('quita secuencias con forma de etiqueta, también partidas o anidadas', () => {
    expect(sanitizarTextoPlano('Edema <img src=x onerror=alert(1)>leve')).toBe('Edema leve');
    expect(sanitizarTextoPlano('<scr<script>ipt>alert(1)</script>')).not.toMatch(/<\s*script/i);
    expect(sanitizarTextoPlano('Edema<script>robarSesion()</script> leve')).toBe('Edema leve');
    expect(sanitizarTextoPlano('<!-- x --> ok')).toBe(' ok');
  });
});
