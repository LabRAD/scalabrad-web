package org.labrad.browser

import io.netty.bootstrap.ServerBootstrap
import io.netty.channel.ChannelInitializer
import io.netty.channel.nio.NioEventLoopGroup
import io.netty.channel.socket.SocketChannel
import io.netty.channel.socket.nio.NioServerSocketChannel
import io.netty.handler.codec.http._
import io.netty.handler.codec.http.HttpMethod._
import io.netty.handler.logging.{LogLevel, LoggingHandler}
import java.nio.charset.StandardCharsets.UTF_8
import org.clapper.argot._
import org.clapper.argot.ArgotConverters._
import org.jsoup.Jsoup
import org.labrad.util.Util
import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.{Try, Success, Failure}

/**
 * Configuration for running the labrad web interface.
 */
case class WebServerConfig(
  host: String,
  port: Int,
  urlPrefix: Option[String],
  managerHosts: Map[String, String],
  managerSuffix: Option[String],
  redirectGrapher: Boolean,
  redirectRegistry: Boolean
)

object WebServerConfig {

  /**
   * Create WebServerConfig from command line and map of environment variables.
   *
   * @param args command line parameters
   * @param env map of environment variables, which defaults to the actual
   *        environment variables in scala.sys.env
   * @return Try containing a WebServerConfig instance on success, or a Failure
   *         in the case something went wrong. The Failure will contain an
   *         ArgotUsageException if the command line parsing failed or the
   *         -h or --help options were supplied.
   */
  def fromCommandLine(
    args: Array[String],
    env: Map[String, String] = scala.sys.env
  ): Try[WebServerConfig] = {
    val parser = new ArgotParser("labrad-web",
      preUsage = Some("Web interface to labrad."),
      sortUsage = false
    )
    val hostOpt = parser.option[String](
      names = List("host"),
      valueName = "address",
      description = "Address to bind for listening to incoming connections. " +
        "If not provided, default to 127.0.0.1 to accept connections from " +
        "localhost only. To listen on any interface, use 0.0.0.0."
    )
    val portOpt = parser.option[Int](
      names = List("http-port"),
      valueName = "int",
      description = "Port on which to listen for incoming connections. " +
        "If not provided, fallback to the value given in the LABRADHTTPPORT " +
        "environment variable, with default value 7667."
    )
    val urlPrefixOpt = parser.option[String](
      names = List("url-prefix"),
      valueName = "string",
      description = "Prefix of application urls for use when the server is " +
        "not served at the root url. If not provided, defaults to the empty " +
        "string, which assumes that we are served from the root url path."
    )
    val managerHostsOpt = parser.option[String](
      names = List("manager-hosts"),
      valueName = "string",
      description = "List of manager hostname aliases that can be used to " +
        "connect to manager hosts without including the full host name in " +
        "the application url. Specified as a comma-separated list of pairs " +
        "in the form alias=hostname, for example: " +
        "foo=foo.example.com,bar=bar.example.com"
    )
    val managerSuffixOpt = parser.option[String](
      names = List("manager-suffix"),
      valueName = "string",
      description = "A suffix that will be appended to manager host names " +
        "specified without any periods in the application url. This is an " +
        "alternative to using an explicit list of aliases in manager-hosts. " +
        "If you specify manager-suffix as .example.com, then trying to " +
        "connect to either foo or bar would instead connect to " +
        "foo.example.com or bar.example.com, respectively."
    )
    val redirectGrapherOpt = parser.option[String](
      names = List("redirect-grapher"),
      valueName = "bool",
      description = "Redirect grapher access on other managers to always use " +
        "the datavault on the default manager (default=false)."
    )
    val redirectRegistryOpt = parser.option[String](
      names = List("redirect-registry"),
      valueName = "bool",
      description = "Redirect registry access on other managers to always use " +
        "the registry on the default manager (default=false)."
    )
    val help = parser.flag[Boolean](List("h", "help"),
      "Print usage information and exit")

    Try {
      parser.parse(args)
      if (help.value.getOrElse(false)) parser.usage()

      WebServerConfig(
        host = hostOpt.value.getOrElse("127.0.0.1"),
        port = portOpt.value.orElse(env.get("LABRADHTTPPORT").map(_.toInt)).getOrElse(7667),
        urlPrefix = urlPrefixOpt.value,
        managerHosts = managerHostsOpt.value.map { hosts =>
          hosts.split(",").map { pair =>
            val Array(alias, hostname) = pair.split("=")
            (alias, hostname)
          }.toMap
        }.getOrElse(Map()),
        managerSuffix = managerSuffixOpt.value,
        redirectGrapher = redirectGrapherOpt.value.map(Util.parseBooleanOpt).getOrElse(false),
        redirectRegistry = redirectRegistryOpt.value.map(Util.parseBooleanOpt).getOrElse(false)
      )
    }
  }
}


class WebServer(config: WebServerConfig) {
  val bossGroup = new NioEventLoopGroup(1)
  val workerGroup = new NioEventLoopGroup()
  val staticHandler = new StaticResourceHandler()
  val (appPath, appBytes) = {
    val (path, appString) = staticHandler.getBytes("/index.html") match {
      case Some((path, bytes)) => (path, new String(bytes, UTF_8))
      case None =>
        // When running in dev mode, index.html may not exist yet, so we'll
        // stuff in a placeholder to remind the user to run gulp.
        ("index.html", """<html><body>run gulp to build app</body></html>""")
    }

    val appDom = Jsoup.parse(appString)

    // Change the page base url to match urlPrefix
    for (prefix <- config.urlPrefix) {
      appDom.getElementsByTag("base").first().attr("href", prefix)
    }

    // Add redirect settings to page
    val head = appDom.getElementsByTag("head").first()
    head.appendElement("meta").attr("name", "labrad-redirectGrapher")
                              .attr("content", config.redirectGrapher.toString)
    head.appendElement("meta").attr("name", "labrad-redirectRegistry")
                              .attr("content", config.redirectRegistry.toString)

    // Add version info to page
    head.appendElement("meta").attr("name", "labrad-serverVersion")
                              .attr("content", WebServer.VERSION)

    (path, appDom.toString.getBytes(UTF_8))
  }
  val appFunc = () => staticHandler.makeResponse(appPath, appBytes)
  val connectionConfig = LabradConnectionConfig(config.managerHosts,
                                                config.managerSuffix)

  val b = new ServerBootstrap()
  b.group(bossGroup, workerGroup)
   .channel(classOf[NioServerSocketChannel])
   .handler(new LoggingHandler(LogLevel.INFO))
   .childHandler(new ChannelInitializer[SocketChannel] {
     override def initChannel(ch: SocketChannel): Unit = {
       val pipeline = ch.pipeline
       pipeline.addLast(new HttpServerCodec())
       pipeline.addLast(new HttpObjectAggregator(65536))
       pipeline.addLast(new RoutingHandler(
         WebSocketRoute(GET, "^/api/socket$".r, false, () => new ApiBackend(connectionConfig)),
         AppRoute(GET, "^(/[a-zA-Z0-9\\-_.]+)?/$".r, appFunc),
         AppRoute(GET, "^(/[a-zA-Z0-9\\-_.]+)?/dataset.*$".r, appFunc),
         AppRoute(GET, "^(/[a-zA-Z0-9\\-_.]+)?/grapher.*$".r, appFunc),
         AppRoute(GET, "^(/[a-zA-Z0-9\\-_.]+)?/nodes.*$".r, appFunc),
         AppRoute(GET, "^(/[a-zA-Z0-9\\-_.]+)?/registry.*$".r, appFunc),
         AppRoute(GET, "^(/[a-zA-Z0-9\\-_.]+)?/server.*$".r, appFunc),
         StaticRoute(GET, ".*".r, staticHandler)
       ))
     }
   })

  val channel = b.bind(config.host, config.port).sync().channel

  def stop(): Unit = {
    channel.close()
    channel.closeFuture.sync()
    bossGroup.shutdownGracefully()
    workerGroup.shutdownGracefully()
  }
}

object WebServer {
  val VERSION = {
    val url = getClass.getResource("/org/labrad/browser/version.txt")
    scala.io.Source.fromURL(url).mkString
  }

  def main(args: Array[String]): Unit = {
    val config = WebServerConfig.fromCommandLine(args) match {
      case Success(config) => config

      case Failure(e: ArgotUsageException) =>
        println(e.message)
        return

      case Failure(e: Throwable) =>
        println(s"unexpected error: $e")
        return
    }

    val server = new WebServer(config)

    println(s"now serving at http://localhost:${config.port}")

    // Optionally wait for EOF to stop the server.
    // This is a convenience feature when developing in sbt, allowing the
    // server to be stopped without killing sbt. However, this is generally
    // not desired when deployed; for example, start-stop-daemon detaches
    // from the process, so that stdin gets EOF, but we want the server
    // to continue to run.
    val stopOnEOF = sys.props.get("org.labrad.stopOnEOF") == Some("true")
    if (stopOnEOF) {
      Util.awaitEOF()
      server.stop()
    } else {
      sys.addShutdownHook {
        server.stop()
      }
    }
  }
}
