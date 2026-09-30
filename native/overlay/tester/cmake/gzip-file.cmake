# cmake -DIN=<file in the working directory> -DOUT=<file.gz> -P gzip-file.cmake
cmake_minimum_required(VERSION 3.18)
file(ARCHIVE_CREATE OUTPUT "${OUT}" PATHS "${IN}" FORMAT raw COMPRESSION GZip COMPRESSION_LEVEL 9)
