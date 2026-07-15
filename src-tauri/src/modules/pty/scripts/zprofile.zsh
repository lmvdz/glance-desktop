# glance-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _glance_user_zdotdir="${GLANCE_USER_ZDOTDIR:-$HOME}"
  [ -f "$_glance_user_zdotdir/.zprofile" ] && source "$_glance_user_zdotdir/.zprofile"
  unset _glance_user_zdotdir
}
:
