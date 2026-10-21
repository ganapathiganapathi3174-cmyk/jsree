-- Restrict privileged SECURITY DEFINER procedures to the trusted backend role.
-- These functions accept caller-supplied actor IDs and must not be exposed as
-- unauthenticated PostgREST RPCs.

REVOKE EXECUTE ON FUNCTION public.approve_initial_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_initial_payment(UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_pending_registration(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_pending_registration(UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_delete_topup(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_topup(UUID, UUID)
  TO service_role;
