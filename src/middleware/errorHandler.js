// Manejador de errores final. No filtra detalles internos al cliente.
export function notFound(req, res) {
  res.status(404).json({ error: 'no_encontrado', mensaje: 'Recurso no encontrado.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[error ${ref}]`, err);
  res.status(500).json({
    error: 'error_interno',
    mensaje: 'Ocurrio un error procesando la solicitud.',
    ref,
  });
}
