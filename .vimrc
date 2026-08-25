" ~/.vimrc — plugin-free, works with stock vim on macOS / Linux / BSD

set nocompatible
filetype plugin indent on
syntax on

" Encoding
set encoding=utf-8
set fileencodings=utf-8,big5,gbk,latin1

" Indent: 4 spaces
set expandtab
set tabstop=4
set softtabstop=4
set shiftwidth=4
set autoindent
set smartindent
set backspace=indent,eol,start   " fixes backspace on some systems

" UI
set number
set ruler
set laststatus=2
set showcmd
set scrolloff=3
set wildmenu
set wildmode=list:longest
set mouse=a
set title
set nowrap

" Search
set incsearch
set hlsearch
set ignorecase
set smartcase

" 256 colors when the terminal supports it
if &term =~? 'xterm\|screen\|tmux' || has('nvim')
  set t_Co=256
endif

" Persistent swap / backup / undo under ~/.vim/dirs
set directory=~/.vim/dirs/tmp//
set backup
set backupdir=~/.vim/dirs/backups//
set undofile
set undodir=~/.vim/dirs/undos//
set viminfo+=n~/.vim/dirs/viminfo
for d in [&directory, &backupdir, &undodir]
  let d = substitute(d, '//$', '', '')
  if !isdirectory(expand(d))
    call mkdir(expand(d), 'p')
  endif
endfor

" Mappings
let mapleader = ','
nnoremap <leader><space> :nohlsearch<CR>

" tabs
nnoremap tn :tabnext<CR>
nnoremap tp :tabprevious<CR>
nnoremap tt :tabnew<Space>
nnoremap ts :tab split<CR>

" windows
nnoremap <C-h> <C-w>h
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-l> <C-w>l

" save as sudo
cabbrev w!! w !sudo tee % > /dev/null

" strip trailing whitespace
nnoremap <leader>w :%s/\s\+$//e<CR>

" Filetype overrides
autocmd FileType yaml,json,javascript,typescript,html,css setlocal shiftwidth=2 tabstop=2 softtabstop=2
autocmd FileType make setlocal noexpandtab
autocmd FileType go setlocal noexpandtab tabstop=4 shiftwidth=4
