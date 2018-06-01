CONTAINERID=$1
docker rm -f $CONTAINERID
docker rmi statsd