'use strict';

// ============================================================================
// bot_cobranza_v2 — PWA de agentes
// Reglas: el token de sesion vive SOLO en memoria (nunca localStorage/cookie).
// Recargar la pagina => hay que volver a iniciar sesion. Los datos del cliente
// no se persisten: se borran del DOM al limpiar, al cerrar sesion y al ocultar
// la pagina.
// ============================================================================

var API = '';                       // mismo origen
var SESSION_MINUTES = 60;

var state = {
  token: null,
  expiraEn: null,                   // ISO string que devuelve el backend
  agente: null,
  inactividadTimer: null,
  countdownTimer: null,
};

// ---- helpers de vista ------------------------------------------------------
function $(id) { return document.getElementById(id); }

function mostrarVista(id) {
  ['viewLogin', 'viewActivar', 'viewBuscar'].forEach(function (v) {
    $(v).hidden = (v !== id);
  });
  $('btnLogout').hidden = (id !== 'viewBuscar');
}

function setMsg(el, texto, tipo) {
  el.textContent = texto || '';
  el.className = 'msg' + (tipo ? ' ' + tipo : '');
}

// ---- fetch con manejo de sesion -----------------------------------------
function apiFetch(path, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
  if (opts.body && !opts.headers['Content-Type']) {
    opts.headers['Content-Type'] = 'application/json';
  }
  opts.cache = 'no-store';
  return fetch(API + path, opts).then(function (res) {
    if (res.status === 401 && state.token) {
      cerrarSesionLocal('Tu sesion expiro. Ingresa de nuevo.');
      var e = new Error('sesion'); e.handled = true; throw e;
    }
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { status: res.status, ok: res.ok, data: data };
    });
  });
}

// ---- inactividad / contador -------------------------------------------
function armarInactividad() {
  limpiarTimers();
  state.inactividadTimer = setTimeout(function () {
    // Cierre local; el backend ya habra expirado la sesion por su cuenta.
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
    cerrarSesionLocal('Sesion cerrada por inactividad.');
  }, SESSION_MINUTES * 60 * 1000);

  state.countdownTimer = setInterval(actualizarContador, 30 * 1000);
  actualizarContador();
}

function actualizarContador() {
  if (!state.expiraEn) return;
  var ms = new Date(state.expiraEn).getTime() - Date.now();
  var min = Math.max(0, Math.round(ms / 60000));
  $('sesionRestante').textContent = 'Sesion: ' + min + ' min';
}

function limpiarTimers() {
  if (state.inactividadTimer) clearTimeout(state.inactividadTimer);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.inactividadTimer = null;
  state.countdownTimer = null;
}

// Cada interaccion del usuario renueva la ventana local.
['click', 'keydown', 'touchstart'].forEach(function (ev) {
  document.addEventListener(ev, function () {
    if (state.token) armarInactividad();
  }, { passive: true });
});

function cerrarSesionLocal(mensaje) {
  state.token = null;
  state.expiraEn = null;
  state.agente = null;
  limpiarTimers();
  limpiarResultado();
  $('formLogin').reset();
  $('pin').value = '';
  mostrarVista('viewLogin');
  setMsg($('loginMsg'), mensaje || '', mensaje ? 'error' : '');
}

// ---- LOGIN ------------------------------------------------------------
$('formLogin').addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type=submit]');
  var numero = $('numero').value.trim();
  var pin = $('pin').value.trim();
  setMsg($('loginMsg'), '');

  if (!/^[0-9]{6}$/.test(pin)) {
    setMsg($('loginMsg'), 'El PIN debe tener 6 digitos.', 'error');
    return;
  }
  btn.disabled = true;
  apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ numero: numero, pin: pin }),
  }).then(function (r) {
    btn.disabled = false;
    if (r.data.estado === 'requiere_activacion') {
      $('aNumero').value = numero;
      mostrarVista('viewActivar');
      setMsg($('activarMsg'), r.data.mensaje || '', '');
      return;
    }
    if (r.ok && r.data.estado === 'ok') {
      state.token = r.data.token;
      state.expiraEn = r.data.expira_en;
      state.agente = r.data.agente;
      $('pin').value = '';
      $('agenteNombre').textContent = r.data.agente.nombre || '';
      mostrarVista('viewBuscar');
      setMsg($('buscarMsg'), '');
      $('dni').focus();
      armarInactividad();
      return;
    }
    setMsg($('loginMsg'), r.data.mensaje || 'No se pudo iniciar sesion.', 'error');
  }).catch(function (err) {
    btn.disabled = false;
    if (!err.handled) setMsg($('loginMsg'), 'Error de conexion. Reintenta.', 'error');
  });
});

// ---- ACTIVAR PIN ----------------------------------------------------
$('formActivar').addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type=submit]');
  var body = {
    numero: $('aNumero').value.trim(),
    codigo_activacion: $('aCodigo').value.trim(),
    pin: $('aPin').value.trim(),
    pin_repeat: $('aPin2').value.trim(),
  };
  setMsg($('activarMsg'), '');
  if (body.pin !== body.pin_repeat) {
    setMsg($('activarMsg'), 'Los PIN no coinciden.', 'error');
    return;
  }
  if (!/^[0-9]{6}$/.test(body.pin)) {
    setMsg($('activarMsg'), 'El PIN debe tener 6 digitos.', 'error');
    return;
  }
  btn.disabled = true;
  apiFetch('/api/auth/activar', { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) {
      btn.disabled = false;
      if (r.ok && r.data.estado === 'activado') {
        $('formActivar').reset();
        mostrarVista('viewLogin');
        setMsg($('loginMsg'), 'PIN configurado. Ahora ingresa con tu numero y PIN.', 'ok');
        return;
      }
      setMsg($('activarMsg'), r.data.mensaje || 'No se pudo activar el PIN.', 'error');
    })
    .catch(function (err) {
      btn.disabled = false;
      if (!err.handled) setMsg($('activarMsg'), 'Error de conexion. Reintenta.', 'error');
    });
});

$('btnVolverLogin').addEventListener('click', function () {
  $('formActivar').reset();
  mostrarVista('viewLogin');
});

// ---- LOGOUT -------------------------------------------------------
$('btnLogout').addEventListener('click', function () {
  apiFetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
  cerrarSesionLocal('');
});

// ---- BUSCAR -----------------------------------------------------
$('formBuscar').addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type=submit]');
  var dni = $('dni').value.trim();
  setMsg($('buscarMsg'), '');
  limpiarResultado();

  if (!/^[0-9]{8}$/.test(dni)) {
    setMsg($('buscarMsg'), 'El DNI debe tener exactamente 8 digitos.', 'error');
    return;
  }
  btn.disabled = true;
  apiFetch('/api/clientes/' + encodeURIComponent(dni))
    .then(function (r) {
      btn.disabled = false;
      if (r.status === 404) {
        setMsg($('buscarMsg'), r.data.mensaje || 'DNI no encontrado.', 'error');
        return;
      }
      if (r.status === 429) {
        setMsg($('buscarMsg'), r.data.mensaje || 'Limite de consultas alcanzado.', 'error');
        return;
      }
      if (!r.ok) {
        setMsg($('buscarMsg'), r.data.mensaje || 'No se pudo consultar.', 'error');
        return;
      }
      renderCliente(r.data.cliente);
    })
    .catch(function (err) {
      btn.disabled = false;
      if (!err.handled) setMsg($('buscarMsg'), 'Error de conexion. Reintenta.', 'error');
    });
});

$('btnLimpiar').addEventListener('click', function () {
  limpiarResultado();
  $('formBuscar').reset();
  $('dni').focus();
});

function limpiarResultado() {
  $('resultado').hidden = true;
  $('rNombre').textContent = '';
  $('rCampos').textContent = '';
}

// ---- render del cliente ------------------------------------------
var CAMPOS = [
  ['estatus_cliente', 'Estatus'],
  ['pdp_pendiente', 'PDP pendiente', true],
  ['telefono_1', 'Telefono 1'],
  ['telefono_2', 'Telefono 2'],
  ['direccion', 'Direccion'],
  ['__ubicacion', 'Ubicacion'],
  ['monto_adeudado', 'Deuda actual (S/)', false, true],
  ['capital', 'Capital (S/)', false, true],
  ['cuota_mayor_atraso', 'Cuota mayor atraso (S/)', false, true],
  ['dias_atraso', 'Dias de atraso'],
  ['fecha_prox_pago', 'Proximo pago'],
  ['camp_liquidacion', 'Campaña liquidacion'],
  ['camp_refinanciado', 'Campaña refinanciado'],
  ['fec_ultima_gestion_campo', 'Ultima gestion de campo'],
  ['ultima_reaccion_campo', 'Reaccion (ult. gestion)'],
  ['ultima_obs_campo', 'Observacion (ult. gestion)'],
  ['gestor_asignado', 'Gestor asignado'],
  ['gerencia', 'Gerencia'],
  ['region', 'Region'],
  ['cuenta_ref_mask', 'Cuenta (ref.)'],
];

var soles = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderCliente(c) {
  if (!c) return;
  $('rNombre').textContent = c.nombre_completo || '(sin nombre)';
  var dl = $('rCampos');
  dl.textContent = '';

  CAMPOS.forEach(function (def) {
    var key = def[0], label = def[1], esAlerta = def[2], esMoneda = def[3];
    var valor;

    if (key === '__ubicacion') {
      valor = [c.distrito, c.provincia, c.departamento].filter(Boolean).join(' · ');
    } else {
      valor = c[key];
    }
    if (valor === null || valor === undefined || valor === '') return;

    if (esMoneda && !isNaN(Number(valor))) valor = soles.format(Number(valor));
    if (key === 'cuenta_ref_mask') valor = '••••' + valor;

    var div = document.createElement('div');
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = String(valor);
    if (esAlerta) dd.className = 'alerta';
    div.appendChild(dt);
    div.appendChild(dd);
    dl.appendChild(div);
  });

  $('resultado').hidden = false;
}

// No dejar datos visibles si la app pasa a segundo plano / se cierra.
window.addEventListener('pagehide', limpiarResultado);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') limpiarResultado();
});

// ---- arranque --------------------------------------------------
mostrarVista('viewLogin');
$('numero').focus();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(function () {});
}
